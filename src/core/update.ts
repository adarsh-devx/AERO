/**
 * Pure helpers for the in-app update system: semantic version parsing /
 * comparison and GitHub release asset selection. Framework-free on purpose
 * (no React, no networking, no native calls) so the logic that decides
 * "is this newer?" and "is this the right APK?" is trivially auditable.
 */

/** A parsed semantic version (major.minor.patch). */
export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * Strict `vX.Y.Z` / `X.Y.Z` parser — the ONLY shape the release pipeline
 * produces (tag `v*`, workflow enforces exactly three numeric parts).
 * Anything else (malformed tags, beta/rc suffixes this pipeline never
 * ships) parses to null and is ignored gracefully: an unrecognised release
 * can never trigger an update, a downgrade or a loop.
 */
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(raw: string | null | undefined): SemVer | null {
  if (typeof raw !== 'string') return null;
  const match = VERSION_PATTERN.exec(raw.trim());
  if (match === null) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    return null;
  }
  return { major, minor, patch };
}

/** Numeric (never lexicographic) three-component comparison. */
export function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/** True only when `candidate` is strictly newer than `current` (no downgrades, no loops on equality). */
export function isNewer(candidate: SemVer, current: SemVer): boolean {
  return compareVersions(candidate, current) > 0;
}

/** Normalised display form, e.g. `1.0.1`. */
export function formatVersion(version: SemVer): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/**
 * The ONE GitHub endpoint Aero checks for updates — the repository's
 * expected owner/name is pinned here on purpose: update data from any
 * other source is never trusted. `/releases/latest` already excludes
 * drafts and pre-releases, so a beta release can never be offered.
 */
export const AERO_RELEASE_LATEST_URL =
  'https://api.github.com/repos/adarsh-devx/AERO/releases/latest';

/** Refuse to auto-download anything smaller than this (corrupt/mislabeled assets). */
export const MIN_UPDATE_APK_BYTES = 5 * 1024 * 1024;

/** Hosts a release asset URL may point at (GitHub's own download chain). */
const ALLOWED_ASSET_HOSTS: readonly string[] = [
  'github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
];

/**
 * Release-asset subset of GitHub's API shape — only the fields the
 * selection logic reads, everything else ignored.
 */
export interface GithubReleaseAsset {
  readonly name?: unknown;
  readonly browser_download_url?: unknown;
  readonly size?: unknown;
  readonly content_type?: unknown;
}

/** The single accepted update artifact. */
export interface UpdateAsset {
  readonly name: string;
  readonly url: string;
  readonly sizeBytes: number;
}

/**
 * CI publishes ONE universal APK plus ABI-specific splits, named
 * `Aero-vX.Y.Z-universal.apk` (older releases: `Aero-v1.0.0-…`).
 * Only the universal artifact is ever acceptable — an ABI split could be
 * wrong for the device, and anything else (source zips, debug builds,
 * unrelated files) must never be downloaded.
 */
const UNIVERSAL_APK_NAME = /^Aero-v\d+\.\d+\.\d+-universal\.apk$/i;

function isAllowedAssetUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_ASSET_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

/**
 * Picks the ONE acceptable update APK from a release's assets, or null
 * when there is none (caller fails gracefully — no broken update state).
 *
 * A candidate must pass ALL of: CI's universal-APK naming, an HTTPS URL
 * on GitHub's own hosts, a plausible size, and a non-contradicting MIME
 * type (missing / octet-stream / the Android package archive). Among
 * valid candidates the proper Android APK MIME type wins.
 */
export function selectUpdateAsset(
  assets: readonly GithubReleaseAsset[] | null | undefined,
): UpdateAsset | null {
  if (!Array.isArray(assets)) return null;

  let best: UpdateAsset | null = null;
  let bestPreferred = false;

  for (const asset of assets) {
    const name = asset?.name;
    const url = asset?.browser_download_url;
    if (typeof name !== 'string' || !UNIVERSAL_APK_NAME.test(name)) continue;
    if (typeof url !== 'string' || !isAllowedAssetUrl(url)) continue;

    const size = typeof asset.size === 'number' && Number.isFinite(asset.size) ? asset.size : 0;
    if (size < MIN_UPDATE_APK_BYTES) continue;

    const mime =
      typeof asset.content_type === 'string' ? asset.content_type.toLowerCase() : '';
    const mimeOk =
      mime === '' ||
      mime === 'application/octet-stream' ||
      mime.includes('android.package-archive');
    if (!mimeOk) continue;

    const preferred = mime.includes('android.package-archive');
    if (best === null || (preferred && !bestPreferred)) {
      best = { name, url, sizeBytes: size };
      bestPreferred = preferred;
    }
  }

  return best;
}
