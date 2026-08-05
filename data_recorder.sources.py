# REPLACE the empty `SOURCES: list[Source] = []` at the bottom of
# koyu-runtime/koyu_runtime/services/data_recorder.py with this block.
#
# Rig: LIBERO sim eval over the policy contract (eval_contract.py). The
# sim is lockstep, so every non-clock source pairs by exact frame_id
# (paired=True), never timestamp windows. eval/obs/agentview is the clock;
# eval/action echoes the observation's frame_id and timestamp.
#
# Feature names are LeRobot-style keys on purpose: they match what policy
# templates' dataloader.py expects (observation.images.* / observation.state
# / action), so eval episodes are directly trainable.
def _img(cell) -> "Any":
    import numpy as np
    return np.frombuffer(bytes(cell.data[: cell.height * cell.width * 3]),
                         dtype=np.uint8).reshape(cell.height, cell.width, 3)


def _vec(cell) -> list[float]:
    return [float(v) for v in cell.values[: cell.valid_len]]


_EVAL_HZ = 20.0            # suites.yaml fps: the sim lockstep rate

SOURCES: list[Source] = [
    Source(topic="eval/obs/agentview", feature="observation.images.agentview",
           extract=_img, schema={"dtype": "video"}, kind="video",
           rate_hz=_EVAL_HZ, type_name="ImageCell"),
    Source(topic="eval/obs/wrist", feature="observation.images.wrist",
           extract=_img, schema={"dtype": "video"}, kind="video",
           rate_hz=_EVAL_HZ, type_name="ImageCell", paired=True),
    Source(topic="eval/obs/state", feature="observation.state",
           extract=_vec, schema={"dtype": "float32", "shape": [9]}, kind="column",
           rate_hz=_EVAL_HZ, type_name="VecCell", paired=True),
    Source(topic="eval/action", feature="action",
           extract=_vec, schema={"dtype": "float32", "shape": [7]}, kind="column",
           rate_hz=_EVAL_HZ, type_name="VecCell", paired=True),
]
