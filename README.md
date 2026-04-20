# Improved DIS Plugin for Unreal

This repository is a maintained derivative of [AF-GRILL/DISPluginForUnreal](https://github.com/AF-GRILL/DISPluginForUnreal), focused on Unreal Engine 5.7 compatibility and cross-platform runtime fixes (Win64 and macOS).

## What This Fork Adds

- Unreal Engine 5.7 plugin descriptor updates
- Explicit Win64 and Mac support in runtime/editor modules
- Runtime platform helper Blueprint functions
- UDP and receive-flow fixes for better cross-platform behavior
- Updated Entity State / Entity State Update heartbeat flow compatibility

## Requirements

- Unreal Engine 5.7
- `GeoReferencing` plugin enabled
- UDP traffic allowed by local firewall (for network testing)
- Node.js (only for the web test tool)

## Quick Setup

1. Clone this repository.
2. Place the plugin in your Unreal project's `Plugins` folder.
3. Open the project and let Unreal rebuild modules if needed.
4. Confirm `GeoReferencing` is enabled.

## Minimal Unreal Configuration

1. Add one `DIS Game Manager` actor to the level.
2. Configure auto receive/send sockets on the manager as needed.
3. Add one `GeoReferencingSystem` actor and set your origin.
4. For actors that transmit DIS, attach `DIS Send Component`.
5. For actors that consume DIS, attach `DIS Receive Component`.
6. Set Exercise/Site/Application IDs to match your simulation network.

## How It Works

- `ADISGameManager` coordinates entity mapping and PDU dispatch.
- `UUDPSubsystem` owns UDP socket lifecycle and byte I/O.
- `UDISSendComponent` forms and emits PDUs from actor state.
- `UDISReceiveComponent` handles incoming updates, dead reckoning, and optional ground clamping.

Entity mapping is handled by `ADISGameManager` using Entity ID and configured class-enum mappings. If an incoming entity is unknown, the manager can spawn the mapped actor class when a mapping exists.

## DISTestWeb (Web Test Tool)

`DISTestWeb` is a lightweight browser + Node.js utility to drive one test entity and send DIS `EntityStatePDU` packets over UDP.

Project root commands:

```bash
node DISTestWeb/server.js
```

Public/LAN mode:

```bash
node DISTestWeb/server.js public
```

Open:

```text
http://127.0.0.1:7070
```

Notes:

- Browser code cannot send raw UDP directly; `server.js` is the UDP bridge.
- Default DIS port is typically `3000`.
- Unreal receive port and web `targetPort` must match.
- Geo origin values should match between Unreal and the web tool.

## Troubleshooting

- No packets received: check port match, firewall, and send mode (`broadcast` / `unicast` / `multicast`).
- Position mismatch: verify the same geo origin on both sides.
- Motion jitter: tune dead reckoning smoothing and ground clamping settings.

## Useful Source References

- `Source/DISRuntime/Public/DISGameManager.h`
- `Source/DISRuntime/Public/DISSendComponent.h`
- `Source/DISRuntime/Public/DISReceiveComponent.h`
- `Source/DISRuntime/Public/UDPSubsystem.h`
- `DISTestWeb/server.js`

## Upstream and License

This repository is based on [AF-GRILL/DISPluginForUnreal](https://github.com/AF-GRILL/DISPluginForUnreal).

- Original plugin owner: Gaming Research Integration for Learning Laboratory (GRILL)
- Upstream: https://github.com/AF-GRILL/DISPluginForUnreal
- License: BSD 2-Clause

See [LICENSE](LICENSE) for full terms.
