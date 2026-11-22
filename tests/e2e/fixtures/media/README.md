# Browser media fixtures

`download-source.webm` is the clip the download scenario's fake `yt-dlp`
publishes. It is 3 seconds of ffmpeg's `testsrc2` pattern at 320x180, VP8, no
audio, so Chromium can decode and seek it without proprietary codecs.

It is original synthetic material, not copied from a third-party video:
CC0-equivalent, same terms as
[src-api/test/fixtures/video/reference/LICENSE.md](../../../../src-api/test/fixtures/video/reference/LICENSE.md).

Regenerate from this directory:

```bash
ffmpeg -y -f lavfi -i testsrc2=size=320x180:rate=15:duration=3 \
  -c:v libvpx -b:v 220k -an download-source.webm
```
