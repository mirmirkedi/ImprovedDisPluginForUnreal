# Improved DIS Plugin for Unreal

This repository is an independently published derivative of [AF-GRILL/DISPluginForUnreal](https://github.com/AF-GRILL/DISPluginForUnreal) focused on the compatibility and runtime fixes added during our Unreal Engine 5 update work.

## What Changed

This version includes the improvements we added on top of the original plugin:

- updated the plugin descriptor for Unreal Engine 5.7
- added explicit Win64 and macOS platform support in the `.uplugin` file and `DISRuntime.Build.cs`
- added Blueprint runtime platform helpers: `GetCurrentPlatformName`, `IsRunningOnWindows`, and `IsRunningOnMac`
- added cross-platform networking/runtime fixes around UDP behavior, loopback handling, and game-thread receive flow
- kept heartbeat-based Entity State / Entity State Update sending behavior aligned with the updated runtime codepath
- included supporting compatibility fixes in the DIS runtime and bundled third-party/OpenDIS sources used by the plugin

## Setup and Usage

For installation steps, usage details, actor setup, and the original plugin documentation, refer to the upstream project:

- [AF-GRILL/DISPluginForUnreal](https://github.com/AF-GRILL/DISPluginForUnreal)

## License and Attribution

This repository is based on [AF-GRILL/DISPluginForUnreal](https://github.com/AF-GRILL/DISPluginForUnreal).

- Original plugin and copyright: Gaming Research Integration for Learning Laboratory (GRILL)
- Original upstream repository: https://github.com/AF-GRILL/DISPluginForUnreal
- License: BSD 2-Clause

This repository keeps the original license text in [LICENSE](LICENSE). If you redistribute this repository in source or binary form, retain the original copyright notice, license terms, and disclaimer.
