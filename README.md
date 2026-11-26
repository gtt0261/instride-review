# InStride expert data review

[Open the English review site](https://gtt0261.github.io/instride-review/). Share a scene with **Copy link**. **Play route** loads video when requested. **Auto** uses the lightweight 540p stream on weaker or unmeasured connections and can drop from 1080p if playback stalls. Reviewers can select either resolution directly. The individual camera views use previews with links to the original 4K images.

## Review workflow

1. Check the instruction, target part, and operating side using **Final stop**, **Reverse check**, and the top view.
2. Verify that the cylinder can reach and stand in the marked approach area. Use **Draw approach area** and **Mark no-stop zone** to propose corrections. Use **Request changes** with a reason when proposing a correction. Reopen the revised evidence before approving it.
3. Confirm both checks and choose **Approve**. The public site exports the review JSON from the reviewer's browser. The team service records decisions in a private per-scene journal and reports which current revisions are approved for pilot collection.

The [candidate set](evaluation-candidates.json) contains the airport and five additional short routes. Route lengths use estimated scene scales. The recordings and their geometric checks help reviewers inspect the target and approach area. Formal TA acceptance and scene registration are part of the benchmark pipeline.

## Run the team service

Use Python 3.12 or newer. The service binds to loopback. Run it behind the team's private access path and keep its review directory out of public deployments.

```sh
python -B scripts/review_webui.py --reviews /path/to/private/reviews serve --port 8790
python -B scripts/review_webui.py --reviews /path/to/private/reviews eligible
```

Add `--case <case-id>` to the `eligible` command to require an approved current revision for one candidate. Exit status 2 means that candidate is ineligible. The report includes the source revision, review ID, target part, and approach rectangle. Scene units are used for the rectangle. The revision fingerprints the candidate record, trajectory, visibility audit, render receipt, and original and lightweight media. Journals preserve earlier revisions and deduplicate retried review IDs.

## Prepare and verify a version

Run `python -B scripts/prepare_review_media.py` after updating source evidence. The script requires FFmpeg with H.264 and WebP support. It checks presentation times against every recorded frame before publishing the preview index. The original 1080p videos and 4K stills are used for detailed inspection.

Run `python -B -m unittest discover -s tests -v` for review and range handling. Run `node tests/browser.cjs` with Playwright installed for the browser smoke test. The test uses a temporary review journal. Set `REVIEW_BROWSER_EXE` for a locally installed browser if needed. Passing an anonymous deployment URL as the first argument exercises the public export workflow.

The underlying scenes are reconstructions from [DL3DV-10K](https://huggingface.co/datasets/DL3DV/DL3DV-GS-960P). [Research dataset terms](https://github.com/DL3DV-10K/Dataset/blob/main/License.md). The airport lighting uses [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky).
