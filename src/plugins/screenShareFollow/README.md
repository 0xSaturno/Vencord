# ScreenShareFollow

Automatically switches your Discord shared screen to whichever monitor your mouse cursor is on.

## How It Works

1. **Stream starts** → Plugin detects via `STREAM_CREATE` Flux event
2. **Polls cursor position** every 300ms using Electron's `screen.getCursorScreenPoint()`
3. **Cursor moves to new monitor** → Starts a debounce timer (default 500ms)
4. **Cursor stays** → Dispatches `MEDIA_ENGINE_SET_GO_LIVE_SOURCE` to switch the stream source
5. **Cursor moves back** → Cancels the pending switch
6. **Stream ends** → Stops polling

## Settings

| Setting       | Default | Description                                                           |
| ------------- | ------- | --------------------------------------------------------------------- |
| Enabled       | `true`  | Master toggle for the auto-switch behavior                            |
| Poll Interval | `300ms` | How often to check cursor position. Lower = faster, more CPU          |
| Switch Delay  | `500ms` | Debounce — cursor must stay on new monitor this long before switching |

## Technical Details

### Source Switching
Uses Discord's internal `MEDIA_ENGINE_SET_GO_LIVE_SOURCE` Flux event — the same mechanism triggered by the "Switch Source" / "Change Windows" button. Stream quality settings (resolution, framerate, sound) are cached from the initial stream and preserved across switches.

### Source Enumeration
Screen sources are enumerated via `DiscordNative.desktopCapture.getDesktopCaptureSources()`, which returns source IDs in `screen:N:0` format.

### Cursor Tracking
Uses Electron's `screen` module (`getCursorScreenPoint()` + `getDisplayNearestPoint()`) to detect which monitor the cursor is on. The plugin tries multiple methods to access the screen API:
1. `window.require("electron").screen`
2. `DiscordNative.nativeModules.requireModule("electron").screen`
3. `require("@electron/remote").screen`
4. `VencordNative.screen`

### Requirements
- **Discord Desktop** (not web or Vesktop)
- **2+ monitors** connected
- **Electron screen API** must be accessible

## Troubleshooting

### "Electron screen API not available"
The plugin couldn't access cursor position tracking. Check the DevTools console for which methods were attempted. This is the main potential issue — if Discord's Electron sandbox blocks access to the `screen` module, an alternative approach may be needed.

### Wrong monitor mapping
If the plugin switches to the wrong screen, the display-to-source index mapping may be off. Check the console logs at startup to see which source IDs are mapped to which displays.
