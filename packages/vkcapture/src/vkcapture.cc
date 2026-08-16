/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Consumer for obs-vkcapture's protocol: games launched with OBS_VKCAPTURE=1
 * hand us a dmabuf of their swapchain, which we import, scale and convert to
 * I420 on the GPU, and read back at the requested stream size. The compositor
 * is never involved, so a fullscreen game keeps direct scanout.
 */

#include "capture.h"

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl3.h>
#include <napi.h>

#include <atomic>
#include <chrono>
#include <cstring>
#include <future>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <errno.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#define GL_DEVICE_UUID_EXT 0x9597

// Declared here rather than pulled from gl2ext.h, which clashes with gl3.h
using PfnImageTargetTexture2D = void (*)(GLenum target, void *image);
using PfnGetUnsignedBytei_v = void (*)(GLenum target, GLuint index, GLubyte *data);

namespace
{

const char SOCK_NAME[] = "/com/obsproject/vkcapture";

struct Client
{
    int fd = -1;
    std::string exe;
    bool selected = false;
    bool announcedCapturing = false;
};

struct Texture
{
    bool valid = false;
    int width = 0;
    int height = 0;
    int format = 0;
    int strides[4] = {0, 0, 0, 0};
    int offsets[4] = {0, 0, 0, 0};
    uint64_t modifier = 0;
    uint8_t nfd = 0;
    bool flip = false;
    int fds[4] = {-1, -1, -1, -1};
};

struct FrameData
{
    std::vector<uint8_t> pixels;
    int width;
    int height;
    int64_t timestampUs;
};

const char *VS_SRC = R"(#version 300 es
void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
)";

/*
 * Packs I420 into an RGBA8 target: four consecutive plane bytes per texel, so
 * one draw and one readback produce the exact buffer VideoFrame expects.
 * Target is (outW / 4) x (outH * 3 / 2): Y rows first, then U, then V.
 */
const char *FS_SRC = R"(#version 300 es
precision highp float;
precision highp int;

uniform sampler2D tex;
uniform ivec2 outSize;      // luma plane size
uniform vec2 tapOffset;     // quarter of the source footprint, in source uv
uniform vec2 fitScale;      // aspect-preserving fit of source into target
uniform vec2 fitOffset;
uniform int flipY;

out vec4 color;

vec3 sampleSrc(vec2 uv) {
    vec2 s = (uv - fitOffset) / fitScale;
    // outside the fitted image is video black, which toY/toU/toV map to 16/128
    if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) return vec3(0.0);
    if (flipY == 1) s.y = 1.0 - s.y;
    // 4-tap box keeps a 4K source from aliasing into 720p
    vec3 c = texture(tex, s + vec2(-tapOffset.x, -tapOffset.y)).rgb;
    c += texture(tex, s + vec2(tapOffset.x, -tapOffset.y)).rgb;
    c += texture(tex, s + vec2(-tapOffset.x, tapOffset.y)).rgb;
    c += texture(tex, s + vec2(tapOffset.x, tapOffset.y)).rgb;
    return c * 0.25;
}

// BT.601 limited range, which is what an unannotated I420 VideoFrame implies
float toY(vec3 c) { return 0.0625 + 0.257 * c.r + 0.504 * c.g + 0.098 * c.b; }
float toU(vec3 c) { return 0.5 - 0.148 * c.r - 0.291 * c.g + 0.439 * c.b; }
float toV(vec3 c) { return 0.5 + 0.439 * c.r - 0.368 * c.g - 0.071 * c.b; }

void main() {
    ivec2 t = ivec2(gl_FragCoord.xy);
    int baseX = t.x * 4;
    int lumaRows = outSize.y;
    int chromaRows = outSize.y / 4;
    vec4 outBytes;

    if (t.y < lumaRows) {
        for (int k = 0; k < 4; k++) {
            vec2 uv = (vec2(float(baseX + k), float(t.y)) + 0.5) / vec2(outSize);
            outBytes[k] = toY(sampleSrc(uv));
        }
    } else {
        bool isU = t.y < lumaRows + chromaRows;
        int row = isU ? t.y - lumaRows : t.y - lumaRows - chromaRows;
        int idx = row * outSize.x + baseX;
        int chromaW = outSize.x / 2;
        int cy = idx / chromaW;
        int cx = idx - cy * chromaW;
        for (int k = 0; k < 4; k++) {
            // sample the centre of the 2x2 luma block this chroma sample covers
            vec2 uv = (vec2(float((cx + k) * 2), float(cy * 2)) + 1.0) / vec2(outSize);
            vec3 c = sampleSrc(uv);
            outBytes[k] = isU ? toU(c) : toV(c);
        }
    }
    color = outBytes;
}
)";

class Capturer
{
  public:
    ~Capturer() { close(); }

    bool open(std::string &err);
    void close();

    std::vector<std::string> clients();

    bool startCapture(const std::string &exe, int width, int height, int fps, Napi::Env env,
                      Napi::Function cb, std::string &err);
    void stopCapture();

  private:
    void threadMain();
    bool eglInit(std::string &err);
    void eglShutdown();
    bool bindSocket(std::string &err);

    void pollSocket(int timeoutMs);
    void acceptClient();
    void readClient(size_t index);
    void dropClient(size_t index);
    void sendControl(Client &c, bool capturing);
    void applySelection();

    bool ensureImage();
    void releaseImage();
    bool renderAndRead(std::vector<uint8_t> &out);

    std::thread thread_;
    std::atomic<bool> running_{false};
    std::atomic<bool> capturing_{false};

    std::mutex mutex_;
    std::vector<Client> clients_;
    std::string wantExe_;
    Texture pending_;
    bool pendingIsNew_ = false;

    int sockfd_ = -1;
    int outW_ = 1280, outH_ = 720, fps_ = 60;

    Napi::ThreadSafeFunction tsfn_;
    bool tsfnActive_ = false;

    EGLDisplay dpy_ = EGL_NO_DISPLAY;
    EGLContext ctx_ = EGL_NO_CONTEXT;
    uint8_t deviceUuid_[16] = {0};

    EGLImageKHR image_ = EGL_NO_IMAGE_KHR;
    Texture current_;
    GLuint srcTex_ = 0, prog_ = 0, vao_ = 0, fbo_ = 0, fboTex_ = 0, pbo_[2] = {0, 0};
    int pboIndex_ = 0;
    bool pboPrimed_ = false;
    size_t frameBytes_ = 0;

    PFNEGLCREATEIMAGEKHRPROC pCreateImage_ = nullptr;
    PFNEGLDESTROYIMAGEKHRPROC pDestroyImage_ = nullptr;
    PfnImageTargetTexture2D pImageTargetTexture_ = nullptr;
};

bool Capturer::bindSocket(std::string &err)
{
    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = PF_LOCAL;
    addr.sun_path[0] = '\0'; // abstract socket, so it works across sandboxes
    memcpy(&addr.sun_path[1], SOCK_NAME, sizeof(SOCK_NAME) - 1);

    sockfd_ = socket(PF_LOCAL, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
    if (sockfd_ < 0) {
        err = std::string("socket: ") + strerror(errno);
        return false;
    }
    // address length has to match the layer's byte for byte
    if (bind(sockfd_, (const struct sockaddr *)&addr, sizeof(addr.sun_family) + sizeof(SOCK_NAME)) < 0) {
        err = errno == EADDRINUSE
                  ? "another capture consumer already holds the socket (OBS with a Game Capture source?)"
                  : std::string("bind: ") + strerror(errno);
        ::close(sockfd_);
        sockfd_ = -1;
        return false;
    }
    if (listen(sockfd_, 4) < 0) {
        err = std::string("listen: ") + strerror(errno);
        ::close(sockfd_);
        sockfd_ = -1;
        return false;
    }
    return true;
}

bool Capturer::eglInit(std::string &err)
{
    auto queryDevices = (PFNEGLQUERYDEVICESEXTPROC)eglGetProcAddress("eglQueryDevicesEXT");
    auto getPlatformDisplay = (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");

    EGLDeviceEXT devs[8];
    EGLint ndev = 0;
    if (queryDevices && getPlatformDisplay && queryDevices(8, devs, &ndev) && ndev > 0)
        dpy_ = getPlatformDisplay(EGL_PLATFORM_DEVICE_EXT, devs[0], nullptr);
    if (dpy_ == EGL_NO_DISPLAY)
        dpy_ = eglGetDisplay(EGL_DEFAULT_DISPLAY);

    EGLint major, minor;
    if (!eglInitialize(dpy_, &major, &minor)) {
        err = "eglInitialize failed";
        return false;
    }

    const char *exts = eglQueryString(dpy_, EGL_EXTENSIONS);
    if (!exts || !strstr(exts, "EGL_EXT_image_dma_buf_import")) {
        err = "EGL_EXT_image_dma_buf_import unavailable";
        return false;
    }

    eglBindAPI(EGL_OPENGL_ES_API);
    EGLint cfgAttr[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT, EGL_NONE};
    EGLConfig cfg;
    EGLint ncfg = 0;
    eglChooseConfig(dpy_, cfgAttr, &cfg, 1, &ncfg);

    EGLint ctxAttr[] = {EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE};
    ctx_ = eglCreateContext(dpy_, ncfg ? cfg : EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, ctxAttr);
    if (ctx_ == EGL_NO_CONTEXT) {
        err = "eglCreateContext failed";
        return false;
    }
    if (!eglMakeCurrent(dpy_, EGL_NO_SURFACE, EGL_NO_SURFACE, ctx_)) {
        err = "eglMakeCurrent failed (EGL_KHR_surfaceless_context missing?)";
        return false;
    }

    pCreateImage_ = (PFNEGLCREATEIMAGEKHRPROC)eglGetProcAddress("eglCreateImageKHR");
    pDestroyImage_ = (PFNEGLDESTROYIMAGEKHRPROC)eglGetProcAddress("eglDestroyImageKHR");
    pImageTargetTexture_ =
        (PfnImageTargetTexture2D)eglGetProcAddress("glEGLImageTargetTexture2DOES");
    if (!pCreateImage_ || !pImageTargetTexture_) {
        err = "dmabuf import entry points missing";
        return false;
    }

    // Reporting our real GPU keeps the layer on the tiled fast path; a mismatch
    // makes it fall back to linear host-mapped memory, which costs the game.
    auto getUuid = (PfnGetUnsignedBytei_v)eglGetProcAddress("glGetUnsignedBytei_vEXT");
    if (getUuid)
        getUuid(GL_DEVICE_UUID_EXT, 0, deviceUuid_);

    auto compile = [&](GLenum type, const char *src) -> GLuint {
        GLuint s = glCreateShader(type);
        glShaderSource(s, 1, &src, nullptr);
        glCompileShader(s);
        GLint ok = 0;
        glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
        if (!ok) {
            char log[1024];
            glGetShaderInfoLog(s, sizeof(log), nullptr, log);
            err = std::string("shader compile failed: ") + log;
            return 0;
        }
        return s;
    };

    GLuint vs = compile(GL_VERTEX_SHADER, VS_SRC);
    GLuint fs = vs ? compile(GL_FRAGMENT_SHADER, FS_SRC) : 0;
    if (!vs || !fs)
        return false;

    prog_ = glCreateProgram();
    glAttachShader(prog_, vs);
    glAttachShader(prog_, fs);
    glLinkProgram(prog_);
    GLint linked = 0;
    glGetProgramiv(prog_, GL_LINK_STATUS, &linked);
    if (!linked) {
        char log[1024];
        glGetProgramInfoLog(prog_, sizeof(log), nullptr, log);
        err = std::string("program link failed: ") + log;
        return false;
    }
    glDeleteShader(vs);
    glDeleteShader(fs);
    glGenVertexArrays(1, &vao_);
    return true;
}

void Capturer::eglShutdown()
{
    releaseImage();
    if (fbo_)
        glDeleteFramebuffers(1, &fbo_);
    if (fboTex_)
        glDeleteTextures(1, &fboTex_);
    if (pbo_[0])
        glDeleteBuffers(2, pbo_);
    if (prog_)
        glDeleteProgram(prog_);
    if (vao_)
        glDeleteVertexArrays(1, &vao_);
    fbo_ = fboTex_ = prog_ = vao_ = 0;
    pbo_[0] = pbo_[1] = 0;

    if (ctx_ != EGL_NO_CONTEXT) {
        eglMakeCurrent(dpy_, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        eglDestroyContext(dpy_, ctx_);
        ctx_ = EGL_NO_CONTEXT;
    }
    if (dpy_ != EGL_NO_DISPLAY) {
        eglTerminate(dpy_);
        dpy_ = EGL_NO_DISPLAY;
    }
}

void Capturer::sendControl(Client &c, bool capturing)
{
    struct capture_control_data control;
    memset(&control, 0, sizeof(control));
    control.capturing = capturing ? 1 : 0;
    memcpy(control.device_uuid, deviceUuid_, 16);
    if (send(c.fd, &control, sizeof(control), MSG_NOSIGNAL) < 0 && errno != EPIPE && errno != EAGAIN)
        return;
    c.announcedCapturing = capturing;
}

void Capturer::acceptClient()
{
    int fd = accept4(sockfd_, nullptr, nullptr, SOCK_CLOEXEC | SOCK_NONBLOCK);
    if (fd < 0)
        return;
    Client c;
    c.fd = fd;
    clients_.push_back(c);
}

void Capturer::dropClient(size_t index)
{
    Client &c = clients_[index];
    if (c.selected) {
        std::lock_guard<std::mutex> lock(mutex_);
        for (int i = 0; i < 4; i++) {
            if (pending_.fds[i] >= 0)
                ::close(pending_.fds[i]);
            pending_.fds[i] = -1;
        }
        pending_.valid = false;
    }
    ::close(c.fd);
    clients_.erase(clients_.begin() + index);
}

void Capturer::readClient(size_t index)
{
    Client &c = clients_[index];

    for (;;) {
        uint8_t buf[CAPTURE_TEXTURE_DATA_SIZE];
        struct iovec io = {buf, sizeof(buf)};
        char cmsgBuf[CMSG_SPACE(sizeof(int)) * 4];
        struct msghdr msg = {};
        msg.msg_iov = &io;
        msg.msg_iovlen = 1;
        msg.msg_control = cmsgBuf;
        msg.msg_controllen = sizeof(cmsgBuf);

        ssize_t n = recvmsg(c.fd, &msg, MSG_NOSIGNAL);
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK))
            return;
        if (n <= 0) {
            dropClient(index);
            return;
        }

        if (buf[0] == CAPTURE_CLIENT_DATA_TYPE) {
            struct capture_client_data cd;
            memcpy(&cd, buf, sizeof(cd));
            char exe[49] = {0};
            memcpy(exe, cd.exe, 48);
            {
                std::lock_guard<std::mutex> lock(mutex_);
                c.exe = exe;
            }
            applySelection();
            continue;
        }

        if (buf[0] != CAPTURE_TEXTURE_DATA_TYPE)
            continue;

        struct capture_texture_data td;
        memcpy(&td, buf, sizeof(td));

        struct cmsghdr *cm = CMSG_FIRSTHDR(&msg);
        if (!cm || cm->cmsg_level != SOL_SOCKET || cm->cmsg_type != SCM_RIGHTS) {
            dropClient(index);
            return;
        }
        size_t nfd = (cm->cmsg_len - sizeof(struct cmsghdr)) / sizeof(int);
        int fds[4] = {-1, -1, -1, -1};
        for (size_t i = 0; i < nfd && i < 4; i++)
            fds[i] = ((int *)CMSG_DATA(cm))[i];

        if (!c.selected || nfd != td.nfd) {
            for (size_t i = 0; i < nfd; i++)
                ::close(fds[i]);
            continue;
        }

        std::lock_guard<std::mutex> lock(mutex_);
        for (int i = 0; i < 4; i++) {
            if (pending_.fds[i] >= 0)
                ::close(pending_.fds[i]);
            pending_.fds[i] = fds[i];
        }
        pending_.valid = true;
        pending_.width = td.width;
        pending_.height = td.height;
        pending_.format = td.format;
        pending_.modifier = td.modifier;
        pending_.nfd = td.nfd;
        pending_.flip = td.flip != 0;
        memcpy(pending_.strides, td.strides, sizeof(td.strides));
        memcpy(pending_.offsets, td.offsets, sizeof(td.offsets));
        pendingIsNew_ = true;
    }
}

void Capturer::applySelection()
{
    const bool wantCapture = capturing_.load();
    std::string want;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        want = wantExe_;
    }

    bool haveSelection = false;
    for (auto &c : clients_) {
        if (c.exe.empty())
            continue;
        const bool match = wantCapture && !haveSelection && (want.empty() || c.exe == want);
        if (match)
            haveSelection = true;
        if (c.selected != match || c.announcedCapturing != match) {
            c.selected = match;
            // parking non-targets at capturing=0 leaves other running games alone
            sendControl(c, match);
        }
    }
}

void Capturer::pollSocket(int timeoutMs)
{
    std::vector<struct pollfd> pfds;
    pfds.push_back({sockfd_, POLLIN, 0});
    for (auto &c : clients_)
        pfds.push_back({c.fd, POLLIN, 0});

    if (poll(pfds.data(), pfds.size(), timeoutMs) <= 0)
        return;

    if (pfds[0].revents & POLLIN)
        acceptClient();

    for (size_t i = clients_.size(); i-- > 0;) {
        if (i + 1 < pfds.size() && (pfds[i + 1].revents & (POLLIN | POLLHUP | POLLERR)))
            readClient(i);
    }
}

void Capturer::releaseImage()
{
    if (srcTex_) {
        glDeleteTextures(1, &srcTex_);
        srcTex_ = 0;
    }
    if (image_ != EGL_NO_IMAGE_KHR && pDestroyImage_) {
        pDestroyImage_(dpy_, image_);
        image_ = EGL_NO_IMAGE_KHR;
    }
    for (int i = 0; i < 4; i++) {
        if (current_.fds[i] >= 0)
            ::close(current_.fds[i]);
        current_.fds[i] = -1;
    }
    current_.valid = false;
}

bool Capturer::ensureImage()
{
    Texture next;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!pendingIsNew_)
            return current_.valid;
        next = pending_;
        for (int i = 0; i < 4; i++)
            pending_.fds[i] = -1; // ownership moves to current_
        pendingIsNew_ = false;
        pending_.valid = false;
    }

    releaseImage();

    EGLint attr[64];
    int n = 0;
    attr[n++] = EGL_WIDTH;
    attr[n++] = next.width;
    attr[n++] = EGL_HEIGHT;
    attr[n++] = next.height;
    attr[n++] = EGL_LINUX_DRM_FOURCC_EXT;
    attr[n++] = next.format;

    const EGLint fdA[4] = {EGL_DMA_BUF_PLANE0_FD_EXT, EGL_DMA_BUF_PLANE1_FD_EXT, EGL_DMA_BUF_PLANE2_FD_EXT,
                           EGL_DMA_BUF_PLANE3_FD_EXT};
    const EGLint offA[4] = {EGL_DMA_BUF_PLANE0_OFFSET_EXT, EGL_DMA_BUF_PLANE1_OFFSET_EXT,
                            EGL_DMA_BUF_PLANE2_OFFSET_EXT, EGL_DMA_BUF_PLANE3_OFFSET_EXT};
    const EGLint pitchA[4] = {EGL_DMA_BUF_PLANE0_PITCH_EXT, EGL_DMA_BUF_PLANE1_PITCH_EXT,
                              EGL_DMA_BUF_PLANE2_PITCH_EXT, EGL_DMA_BUF_PLANE3_PITCH_EXT};
    const EGLint loA[4] = {EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT, EGL_DMA_BUF_PLANE1_MODIFIER_LO_EXT,
                           EGL_DMA_BUF_PLANE2_MODIFIER_LO_EXT, EGL_DMA_BUF_PLANE3_MODIFIER_LO_EXT};
    const EGLint hiA[4] = {EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT, EGL_DMA_BUF_PLANE1_MODIFIER_HI_EXT,
                           EGL_DMA_BUF_PLANE2_MODIFIER_HI_EXT, EGL_DMA_BUF_PLANE3_MODIFIER_HI_EXT};

    for (int i = 0; i < next.nfd && i < 4; i++) {
        attr[n++] = fdA[i];
        attr[n++] = next.fds[i];
        attr[n++] = offA[i];
        attr[n++] = next.offsets[i];
        attr[n++] = pitchA[i];
        attr[n++] = next.strides[i];
        if (next.modifier != DRM_FORMAT_MOD_INVALID) {
            attr[n++] = loA[i];
            attr[n++] = (EGLint)(next.modifier & 0xffffffff);
            attr[n++] = hiA[i];
            attr[n++] = (EGLint)(next.modifier >> 32);
        }
    }
    attr[n++] = EGL_NONE;

    image_ = pCreateImage_(dpy_, EGL_NO_CONTEXT, EGL_LINUX_DMA_BUF_EXT, nullptr, attr);
    if (image_ == EGL_NO_IMAGE_KHR) {
        for (int i = 0; i < 4; i++) {
            if (next.fds[i] >= 0)
                ::close(next.fds[i]);
        }
        return false;
    }

    current_ = next;
    current_.valid = true;

    glGenTextures(1, &srcTex_);
    glBindTexture(GL_TEXTURE_2D, srcTex_);
    pImageTargetTexture_(GL_TEXTURE_2D, image_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    return true;
}

bool Capturer::renderAndRead(std::vector<uint8_t> &out)
{
    const int packW = outW_ / 4;
    const int packH = outH_ * 3 / 2;

    if (!fbo_) {
        frameBytes_ = (size_t)outW_ * outH_ * 3 / 2;
        glGenTextures(1, &fboTex_);
        glBindTexture(GL_TEXTURE_2D, fboTex_);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, packW, packH, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
        glGenFramebuffers(1, &fbo_);
        glBindFramebuffer(GL_FRAMEBUFFER, fbo_);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, fboTex_, 0);
        if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE)
            return false;
        glGenBuffers(2, pbo_);
        for (int i = 0; i < 2; i++) {
            glBindBuffer(GL_PIXEL_PACK_BUFFER, pbo_[i]);
            glBufferData(GL_PIXEL_PACK_BUFFER, frameBytes_, nullptr, GL_STREAM_READ);
        }
        glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
    }

    glBindFramebuffer(GL_FRAMEBUFFER, fbo_);
    glViewport(0, 0, packW, packH);
    glUseProgram(prog_);
    glUniform1i(glGetUniformLocation(prog_, "tex"), 0);
    glUniform2i(glGetUniformLocation(prog_, "outSize"), outW_, outH_);
    glUniform1i(glGetUniformLocation(prog_, "flipY"), current_.flip ? 1 : 0);

    // letterbox rather than stretch, so a 16:10 game doesn't come out squashed
    const float srcAspect = (float)current_.width / (float)current_.height;
    const float dstAspect = (float)outW_ / (float)outH_;
    float scaleX = 1.0f, scaleY = 1.0f;
    if (srcAspect > dstAspect)
        scaleY = dstAspect / srcAspect;
    else
        scaleX = srcAspect / dstAspect;
    glUniform2f(glGetUniformLocation(prog_, "fitScale"), scaleX, scaleY);
    glUniform2f(glGetUniformLocation(prog_, "fitOffset"), (1.0f - scaleX) / 2.0f, (1.0f - scaleY) / 2.0f);
    // a quarter of one output texel's source footprint, so the 4 taps straddle it
    glUniform2f(glGetUniformLocation(prog_, "tapOffset"), 0.25f / ((float)outW_ * scaleX),
                0.25f / ((float)outH_ * scaleY));
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, srcTex_);
    glBindVertexArray(vao_);
    glDrawArrays(GL_TRIANGLES, 0, 3);

    // readback lands in a PBO now and is mapped next frame, so the GPU is never waited on
    glBindBuffer(GL_PIXEL_PACK_BUFFER, pbo_[pboIndex_]);
    glReadPixels(0, 0, packW, packH, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);

    const int other = 1 - pboIndex_;
    pboIndex_ = other;
    if (!pboPrimed_) {
        pboPrimed_ = true;
        glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
        return false;
    }

    glBindBuffer(GL_PIXEL_PACK_BUFFER, pbo_[other]);
    void *ptr = glMapBufferRange(GL_PIXEL_PACK_BUFFER, 0, frameBytes_, GL_MAP_READ_BIT);
    if (!ptr) {
        glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
        return false;
    }
    out.resize(frameBytes_);
    memcpy(out.data(), ptr, frameBytes_);
    glUnmapBuffer(GL_PIXEL_PACK_BUFFER);
    glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
    return true;
}

void Capturer::threadMain()
{
    using clock = std::chrono::steady_clock;
    auto next = clock::now();

    while (running_.load()) {
        const bool capturing = capturing_.load();
        const auto interval = std::chrono::microseconds(1000000 / (fps_ > 0 ? fps_ : 60));

        int timeoutMs = 100;
        if (capturing) {
            auto until = std::chrono::duration_cast<std::chrono::milliseconds>(next - clock::now()).count();
            timeoutMs = (int)std::max<int64_t>(0, std::min<int64_t>(until, 100));
        }
        pollSocket(timeoutMs);
        applySelection();

        if (!capturing) {
            next = clock::now();
            continue;
        }
        if (clock::now() < next)
            continue;
        next += interval;
        if (next < clock::now()) // fell behind, don't spiral
            next = clock::now() + interval;

        if (!ensureImage())
            continue;

        std::vector<uint8_t> pixels;
        if (!renderAndRead(pixels))
            continue;

        auto *frame = new FrameData{std::move(pixels), outW_, outH_,
                                    std::chrono::duration_cast<std::chrono::microseconds>(
                                        clock::now().time_since_epoch())
                                        .count()};

        auto status = tsfn_.NonBlockingCall(frame, [](Napi::Env env, Napi::Function cb, FrameData *fd) {
            auto buf = Napi::Buffer<uint8_t>::Copy(env, fd->pixels.data(), fd->pixels.size());
            Napi::Object meta = Napi::Object::New(env);
            meta.Set("width", Napi::Number::New(env, fd->width));
            meta.Set("height", Napi::Number::New(env, fd->height));
            meta.Set("timestampUs", Napi::Number::New(env, (double)fd->timestampUs));
            delete fd;
            cb.Call({buf, meta});
        });
        if (status != napi_ok)
            delete frame; // queue full: drop rather than block the capture loop
    }
}

bool Capturer::open(std::string &err)
{
    if (running_.load())
        return true;
    if (!bindSocket(err))
        return false;

    running_.store(true);

    // EGL has to come up on the capture thread, so wait for its verdict rather
    // than racing a sleep against it
    std::promise<std::string> initResult;
    auto initDone = initResult.get_future();

    thread_ = std::thread([this, p = std::move(initResult)]() mutable {
        std::string initErr;
        const bool ok = eglInit(initErr);
        p.set_value(ok ? "" : (initErr.empty() ? "EGL init failed" : initErr));
        if (ok)
            threadMain();
        eglShutdown();
    });

    const std::string initErr = initDone.get();
    if (!initErr.empty()) {
        err = initErr;
        close();
        return false;
    }
    return true;
}

void Capturer::close()
{
    running_.store(false);
    capturing_.store(false);
    if (thread_.joinable())
        thread_.join();
    if (tsfnActive_) {
        tsfn_.Release();
        tsfnActive_ = false;
    }
    for (auto &c : clients_)
        ::close(c.fd);
    clients_.clear();
    if (sockfd_ >= 0) {
        ::close(sockfd_);
        sockfd_ = -1;
    }
}

std::vector<std::string> Capturer::clients()
{
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<std::string> out;
    for (auto &c : clients_) {
        if (!c.exe.empty())
            out.push_back(c.exe);
    }
    return out;
}

bool Capturer::startCapture(const std::string &exe, int width, int height, int fps, Napi::Env env,
                            Napi::Function cb, std::string &err)
{
    if (!running_.load() && !open(err))
        return false;

    // the I420 pack needs whole texels per row and whole chroma rows
    outW_ = std::max(64, width - (width % 8));
    outH_ = std::max(64, height - (height % 4));
    fps_ = fps > 0 ? fps : 60;

    {
        std::lock_guard<std::mutex> lock(mutex_);
        wantExe_ = exe;
    }

    if (tsfnActive_) {
        tsfn_.Release();
        tsfnActive_ = false;
    }
    tsfn_ = Napi::ThreadSafeFunction::New(env, cb, "vkcapture", 4, 1);
    tsfnActive_ = true;
    pboPrimed_ = false;
    capturing_.store(true);
    return true;
}

void Capturer::stopCapture()
{
    capturing_.store(false);
    if (tsfnActive_) {
        tsfn_.Release();
        tsfnActive_ = false;
    }
}

Capturer g_capturer;

Napi::Value Open(const Napi::CallbackInfo &info)
{
    std::string err;
    if (!g_capturer.open(err))
        throw Napi::Error::New(info.Env(), err);
    return info.Env().Undefined();
}

Napi::Value Clients(const Napi::CallbackInfo &info)
{
    auto list = g_capturer.clients();
    Napi::Array arr = Napi::Array::New(info.Env(), list.size());
    for (size_t i = 0; i < list.size(); i++) {
        Napi::Object o = Napi::Object::New(info.Env());
        o.Set("exe", Napi::String::New(info.Env(), list[i]));
        arr.Set(i, o);
    }
    return arr;
}

Napi::Value Start(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction())
        throw Napi::TypeError::New(env, "start(options, onFrame)");

    Napi::Object opts = info[0].As<Napi::Object>();
    std::string exe = opts.Has("exe") ? opts.Get("exe").ToString().Utf8Value() : "";
    int width = opts.Has("width") ? opts.Get("width").ToNumber().Int32Value() : 1280;
    int height = opts.Has("height") ? opts.Get("height").ToNumber().Int32Value() : 720;
    int fps = opts.Has("fps") ? opts.Get("fps").ToNumber().Int32Value() : 60;

    std::string err;
    if (!g_capturer.startCapture(exe, width, height, fps, env, info[1].As<Napi::Function>(), err))
        throw Napi::Error::New(env, err);
    return env.Undefined();
}

Napi::Value Stop(const Napi::CallbackInfo &info)
{
    g_capturer.stopCapture();
    return info.Env().Undefined();
}

Napi::Value Close(const Napi::CallbackInfo &info)
{
    g_capturer.close();
    return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("open", Napi::Function::New(env, Open));
    exports.Set("clients", Napi::Function::New(env, Clients));
    exports.Set("start", Napi::Function::New(env, Start));
    exports.Set("stop", Napi::Function::New(env, Stop));
    exports.Set("close", Napi::Function::New(env, Close));
    return exports;
}

} // namespace

NODE_API_MODULE(vkcapture, Init)
