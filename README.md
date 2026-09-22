<div align="center">

# 🎵 AERO Music Player

**Ultra-fast, Apple Liquid Glass-inspired streaming music player for Android.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Build & Release](https://github.com/adarsh-devx/AERO/actions/workflows/build-release.yml/badge.svg)](https://github.com/adarsh-devx/AERO/actions/workflows/build-release.yml)
[![React Native](https://img.shields.io/badge/React%20Native-0.86-61dafb.svg?logo=react&logoColor=white)](https://reactnative.dev)
[![Expo](https://img.shields.io/badge/Expo-v57-000020.svg?logo=expo&logoColor=white)](https://expo.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

## ✨ Key Features

- 🍎 **Apple Liquid Glass Design System**:
  - Specular light refraction rims (`rgba(255, 255, 255, 0.35)`).
  - Translucent obsidian dark-frost body.
  - Multi-layer physical depth shadows and native tactile physics.
- ⚡ **0ms Instant Persistent Tab Navigation**:
  - Home, Search, and Library permanently cached in memory (Spotify / YouTube Music architecture).
  - 100% preserved scroll state and zero-delay switching.
- 🎧 **High-Performance Audio Engine**:
  - Seamless background audio playback with lock screen media controls.
  - Predictive track prewarming engine for instant tap-to-play experience.
  - Composite multi-source stream resolver.
- 🔍 **YouTube Music Style Search**:
  - Real-time online search aggregation.
  - Persistent query history and horizontal recent thumbnail rail.
- 📚 **Full Library & Offline Downloads**:
  - Custom playlists management.
  - Pinned liked songs auto-sync.
  - Offline local downloads manager with 1-click playback.
- 🤖 **Automated CI/CD Pipeline**:
  - GitHub Actions automated builds for standalone Android Release APKs.

---

## 🛠️ Tech Stack

- **Framework**: [React Native](https://reactnative.dev/) (Expo 57)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Navigation**: [React Navigation 7](https://reactnavigation.org/) (Native Stack + Persistent Tab Host)
- **Audio Engine**: `expo-audio` + Native Stream Sources
- **Styling**: Native StyleSheet + Liquid Glass WebGL-inspired shaders
- **CI/CD**: GitHub Actions (`build-release.yml`)

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- Node.js (v20 or higher)
- Android Studio / Android SDK (API 34+)
- Expo CLI

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/adarsh-devx/AERO.git
cd AERO

# Install dependencies
npm install
```

### 3. Run on Android
```bash
# Start Android dev build
npx expo run:android
```

---

## 📦 Building Standalone Release APK

To compile a standalone production APK locally:
```bash
cd android
./gradlew assembleRelease
```
The output APK will be generated at:
`android/app/build/outputs/apk/release/app-release.apk`

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <b>Crafted with ❤️ by <a href="https://github.com/adarsh-devx">Adarsh (adarsh-devx)</a></b>
</div>
