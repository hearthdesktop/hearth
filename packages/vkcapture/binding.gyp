{
  "targets": [
    {
      "target_name": "vkcapture",
      "sources": [ "src/vkcapture.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "cflags_cc": [
        "<!(pkg-config --cflags egl glesv2)",
        "-O3",
        "-std=c++17"
      ],
      "libraries": [
        "<!@(pkg-config --libs egl glesv2)"
      ],
      "cflags_cc!": ["-fno-exceptions"],
    }
  ]
}
