# Builds x64 and arm64 on the oldest still-supported Debian, for the widest glibc compatibility
FROM debian:12
ENV DEBIAN_FRONTEND=noninteractive

RUN dpkg --add-architecture arm64

RUN apt-get update && apt-get install -y \
    build-essential python3 curl pkg-config \
    g++-aarch64-linux-gnu \
    libegl1-mesa-dev:amd64 libegl1-mesa-dev:arm64 \
    libgles2-mesa-dev:amd64 libgles2-mesa-dev:arm64 \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get update && apt-get install -y nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
