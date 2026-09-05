# Rocketbox renderer compatibility (2026-09-05)

Scope: the six bundled `avatar_{male,female}_{young,middle,senior}.vrm` bodies.
Reference: the user-provided Downloads README and `封存/public/index.html`,
`封存/tools/rocketbox_to_vrm.mjs`, `vrm_finalize.py`, and `age_texture.py`.

## Texture orientation

The reference conversion removes all texture slots before GLTFExporter runs,
then embeds the original JPEG/PNG bytes afterwards. GLTFExporter would normally
vertically flip the original FBX images; the two-stage export skips that step.
This produced a black mask on the face, misplaced eyes/mouth and a broken suit.

`model-repairs.ts` corrects V once per geometry for the known `m008_*`/`f016_*`
materials. It clones shared UV accessors, leaves vertex positions/morphs intact,
and preserves image alpha. Hair uses map alpha, double-sided alpha testing at
0.35, no redundant green-channel alphaMap, and depth writes, matching the viewer.
Arbitrary glTF and VRoid materials are not changed.

If the source exporter is later fixed to flip its images, remove the runtime UV
compatibility step for those re-exported assets, otherwise it would flip twice.

## Arm pose

The bundled rigs retain A-pose positions even though normalized bone rotations
start at identity. The previous ±90-degree offsets raised the arms. Zero offsets
removed the raised V but still left arms spread diagonally in the actual render.

`createRelaxedArmPose` measures each rig's shoulder/elbow/wrist directions, then
stores relaxed, absolute local rotations. Reapplication does not accumulate;
head/face bones, expressions, voice, conversation events and business state are
untouched. The dev arm override remains available. Authored body animation still
takes precedence over the static resting pose.

## Aged irises

The reference ageing script grays all dark pixels outside a facial ellipse. This
also grays the iris UV island (near the bottom of the head atlas), causing white
pupils in senior variants. A material shader samples only that island from the
unmodified original atlas. Wrinkles and grey hair continue using the aged map.

The two `public/models/rocketbox_*_head_original.jpg` files are byte-for-byte
copies of the user-provided `m008_head_color.jpg` and `f016_head_color.jpg` under
the reference Rocketbox folders; no image regeneration or pixel editing was done.
They retain the source model's licensing obligations. Extra GPU textures are
disposed when the avatar unmounts or a pending load is abandoned.

## Checks

Unit tests cover UV orientation/idempotence/shared accessors, transparent hair,
unaffected non-Rocketbox materials, all six real skeletal hierarchies over repeated
frames, and the original-iris material binding. Existing expression/lipsync tests
are run alongside them. The same VrmStage component is also visually checked in
an isolated local page, without starting a conversation or accessing mic/camera.
