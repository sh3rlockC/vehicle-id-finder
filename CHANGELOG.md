# Changelog

## v0.1.1

- Fixed single-site failures no longer aborting the whole Playwright lookup flow
- Added independent Autohome / Dongchedi error isolation in the Playwright script
- Added Python fallback when Playwright lookup returns no verified result
- Tightened Dongchedi candidate filtering to reduce dirty `/auto/series/<id>` noise from old in-site search pages
- Revalidated on `风云X3PLUS`

## v0.1.0

- Initial public release
- Added Autohome `k.autohome.com.cn` seriesId extraction and verification
- Added Dongchedi Tavily-assisted candidate discovery
- Added fallback chain for Dongchedi `params / community / auto/series`
- Added README, packaging, and GitHub release asset
- Validated on `风云X3PLUS` and `风云T11`
