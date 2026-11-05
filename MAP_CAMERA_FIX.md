# Puerto Rico map centering diagnosis

A read-only request to the live public API `https://roadtripeado.com/api/api/v1/map?limit=100` confirmed:

- Map ID: `69e912c3668604cc97522d2a`
- Display name: `Puerto Rico`
- Stored country: `Bangladesh`

The User Maps page previously passed `selectedMapObj.country` ahead of the dropdown label to its camera panner. Conflicting metadata could therefore send a Puerto Rico selection to Bangladesh. Re-selecting an unchanged country also did not reset the panner, and delayed GPS/IP callbacks could override a later country selection.

Local frontend fixes prioritize the explicit dropdown choice, reset camera intent on every selection (including the same country), clear stale map IDs/search focus, and invalidate pending location work when the country changes. Explicit Locate me still works.

Validation: frontend TypeScript check and production build passed; all 45 focused/regression tests passed. Browser visual QA remains unavailable because the browser host is unavailable.

The live database record has NOT been updated, and frontend changes have NOT been deployed. Correcting the stored country is still necessary for other flows that use map metadata, including country filters and the dashboard.

`scripts/repair-puerto-rico-country.cjs` prepares a narrowly scoped correction. It uses the configured database, checks the exact map ID, verifies the Puerto Rico name and current Bangladesh country, and defaults to a read-only dry run. `--apply` saves a metadata backup, changes only the country field, and verifies the result. Do not execute `--apply` without authorization to correct the production record. No repair command has been executed; its behavior was tested with mocked storage only.

The previous two frontend files are saved in `map-camera-originals.zip`.
