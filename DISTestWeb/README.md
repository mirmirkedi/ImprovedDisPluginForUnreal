# DIS Test Web

Local browser + Node.js test tool for sending one DIS `EntityStatePDU` into the Unreal project.

## Run

From the project root:

```bash
node Tools/DISTestWeb/server.js
```

For LAN/public access on the same network:

```bash
node Tools/DISTestWeb/server.js public
```

Then open:

```text
http://127.0.0.1:7070
```

If `public` was used, the server also prints the LAN URL, such as:

```text
http://192.168.1.34:7070
```

Quick launchers:

- macOS: `Tools/DISTestWeb/start_dis_test_web.command`
- Windows: `Tools\DISTestWeb\start_dis_test_web.cmd`

## What it does

- Draws a single top-down test entity in the browser
- Moves it with keyboard input
- Converts local ENU offsets into ECEF coordinates
- Sends DIS `EntityStatePDU` packets over UDP to the host/port you choose
- Detects your local broadcast address and uses it as the default UDP host
- Supports `broadcast`, `unicast`, and `multicast` modes
- Supports a configurable UDP listen port for receive logging
- Filters out your own recently sent packets from receive logs
- Works on both macOS and Windows with Node.js installed
- Can record sent packets into `.replay` files and replay the same packet timeline later

## Controls

- `W/S`: forward/back
- `A/D`: strafe left/right
- `R/F`: up/down
- `Q/E`: yaw
- `T/G`: pitch
- `Z/C`: roll

## Unreal side

- `DIS Game Manager` receive socket port must match the page UDP port
- Default listen/log port is also `3000`
- `GeoReferencingSystem` origin should match the page origin lat/lon/alt
- Default UDP port is `3000`
- Default host is your detected broadcast IP, similar to `ifconfig | grep broadcast`
- Entity ID can be randomized from the UI and is cached in local storage
- The test page defaults match your shown enum mapping:
  - Entity Kind: `1`
  - Domain: `1`
  - Country: `225`
  - Category: `1`
  - Subcategory: `1`
  - Specific: `3`
  - Extra: `0`

## Notes

- This uses only Node built-ins, no npm install is required.
- Browser JavaScript cannot send raw UDP directly, so `server.js` acts as the local UDP bridge.
- Replay files are saved under `Tools/DISTestWeb/replays`.
