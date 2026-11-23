# InStride short route review

[Open the public review](https://gtt0261.github.io/instride-review/). Select a scene to watch the camera and follow the executed path. **Copy link** copies a link to that scene. Use **Draw approach area** and **Mark no-stop zone** to propose where the robot can and cannot stand, then use **Export review JSON** to share your judgment.

[Download the candidate set](evaluation-candidates.json). It includes the existing airport and five additional reconstructed scenes with an English instruction, specific target part, region, approach area and reference stop. The 40 m limit is applied to executed length at the upper scene-scale estimate. The pool and station include excluded zones supported by scene geometry.

The reference runs use a collision-checked cylinder. The route videos are native 1920 × 1080 at 24 fps. The five review views per scene are native 3840 × 2160. The reverse view shows a 180° heading change at the same stop. Clock, map and camera views use the same executed pose sequence.

## Draft review criteria

1. **H**. The robot enters the intended region.
2. **A**. From the final stop, the shortest traversable distance to an approved approach area is at most 3 m.
3. **S**. The stop is within 2 m of the specified part and faces it with a clear line of sight.

The current approach areas and scale estimates are provisional. Reviews are exported on the reviewer's device. The candidate set awaits human approval.

The scenes are editable reconstructions made using [DL3DV-10K](https://huggingface.co/datasets/DL3DV/DL3DV-GS-960P). Original camera material is credited to the dataset authors. The new videos render task-local geometric copies with representative surface colors. [Research dataset terms](https://github.com/DL3DV-10K/Dataset/blob/main/License.md). The airport lighting uses Poly Haven’s [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky).
