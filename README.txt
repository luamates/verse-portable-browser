VERSE v4

What changed in this build:
- Verse home page with Google / Bing / DuckDuckGo session selection
- Session switcher in the title bar
- Session reset to home clears active tabs and session data
- New tabs always open using the selected session engine
- Ad and Google Ads request blocking added
- GPU acceleration enabled
- Window opens maximized, not fullscreen; taskbar stays visible
- HTML video fullscreen now promotes the app to true fullscreen
- Go back / go forward stay visible whenever the browser is not on Verse home
- Geolocation fixed to New York
- WebRTC leakage reduced with Chromium flags and runtime patches

Important note:
A browser shell alone cannot truly replace your public IP with a real New York IP. That requires a real proxy or VPN route. This build reduces common browser-side IP leakage and keeps the reported location in New York, but network-level IP masking still depends on the connection you use.

Build on Windows:
1. Install Node.js LTS
2. Open this folder
3. Run build.bat
4. The portable EXE will be generated in dist
