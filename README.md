# InStride airport trajectory review

[Open the public review](https://gtt0261.github.io/instride-review/). The page opens in a browser without an account. **Copy link** copies the public address. Use **Export review JSON** to give the review lead your decision, revised approach area and notes.

The route starts beside the baggage carousel in the team's airport parcel-counter reconstruction. Its instruction is “Face the orange slot on the FedEx box.” The area, asset and provisional metric scale are pending human review.

The full first-person replay is native 1920 × 1080 at 24 fps. Departure, carousel turn, approach, stop and reverse-check images are native 3840 × 2160. The reverse check has the same base position and a 180° heading offset. It is a comparison outside the executed route. The reference answer in the memory section comes from mesh visibility on the recorded run.

## Evidence

- [Executed route and actions](run/trajectory.json) records 0-based video-frame poses, the local coordinate convention, measured path in scene units, and tentative metric distances.
- [Geometric checks](run/audit.json) records the camera calibration, support under the cylinder, and nine visibility probes per target and frame.
- [Render receipt](run/run.json) identifies the GPU, native video properties and SHA-256.
- This page presents novel robot-camera renders of the team's editable reconstruction, modeled using the airport scene from [DL3DV-10K](https://huggingface.co/datasets/DL3DV/DL3DV-GS-960P). Original camera material is credited to the dataset authors. [Research dataset terms](https://github.com/DL3DV-10K/Dataset/blob/main/License.md). The reconstructed lighting uses Poly Haven’s [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky).

Reviews are exported on the reviewer's device. A proposed area or individual review does not change the public case's verification status.
