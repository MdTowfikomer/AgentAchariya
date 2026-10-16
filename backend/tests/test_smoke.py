"""Smoke test verifying imports and core logic execution."""

import pytest

from analytics import judge
from illustrations import IllustrationResolver, _compose_svg, _iot_composition
from memory import slugify
from research import _serpapi_findings
from visuals import clean_diagram, clean_supporting_visual


def test_slugify():
    assert slugify("Ravi Kumar") == "ravi-kumar"
    assert slugify("  priya   sharma! ") == "priya-sharma"


def test_judge_analytics():
    # Success if concept taught
    outcome, failure = judge({"concepts_taught": 1, "problems_given": 0, "escalations": 0, "turns": 2, "tool_errors": 0})
    assert outcome == "success"
    assert failure is None

    # Failed if no turns
    outcome, failure = judge({"concepts_taught": 0, "problems_given": 0, "escalations": 0, "turns": 0, "tool_errors": 0})
    assert outcome == "failed"
    assert failure == "no_engagement"


def test_clean_diagram():
    raw = {
        "title": "Water Cycle",
        "layout": "cycle",
        "nodes": [
            {"id": "n1", "label": "Evaporation", "icon": "☀️", "color": "yellow"},
            {"id": "n2", "label": "Condensation", "icon": "☁️", "color": "blue"},
        ],
        "edges": [
            {"from": "n1", "to": "n2", "label": "rises"},
        ],
    }
    cleaned = clean_diagram(raw)
    assert cleaned is not None
    assert cleaned["layout"] == "cycle"
    assert len(cleaned["nodes"]) == 2
    assert len(cleaned["edges"]) == 1


def test_parse_pointers():
    from board_session import _parse_pointers

    assert _parse_pointers("", 5) is None
    parsed = _parse_pointers("i=2, j=4, k=10", 5)
    assert parsed == [{"name": "i", "index": 2}, {"name": "j", "index": 4}]


@pytest.mark.parametrize(
    ("topic", "diagram_type", "subject", "layout"),
    [
        ("Photosynthesis", "cycle", "chloroplast", "cycle"),
        ("Scientific Method", "cycle", "microscope", "cycle"),
        ("Heart Anatomy", "anatomy", "left ventricle", "hub"),
        ("Computer Networks", "network", "computer network", "hub"),
        ("Binary Search", "flowchart", "binary search", "flow"),
        ("Machine Learning", "concept_map", "neural network", "hub"),
        ("Car Engine", "anatomy", "car engine", "hub"),
    ],
)
def test_topic_visual_plans_are_semantic(topic, diagram_type, subject, layout):
    """Representative director outputs remain distinct and renderer-compatible."""
    diagram = clean_diagram({
        "title": topic,
        "diagram_type": diagram_type,
        "nodes": [{"id": "a", "label": "Start"}, {"id": "b", "label": "Result"}],
        "edges": [{"from": "a", "to": "b"}],
    })
    visual = clean_supporting_visual({
        "subject": subject,
        "role": f"Clarifies {topic.lower()}",
        "placement": "side",
        "actions": [{"action": "SHOW"}, {"action": "LABEL", "target": subject}],
    })
    assert diagram is not None
    assert diagram["layout"] == layout
    assert diagram["diagramType"] == diagram_type
    assert visual is not None
    assert visual["subject"] == subject
    assert [action["action"] for action in visual["actions"]] == ["SHOW", "LABEL"]


def test_local_assets_win_before_network_resolution():
    resolver = IllustrationResolver.__new__(IllustrationResolver)
    assert resolver._try_local("photosynthesis") is not None
    assert resolver._try_local("chloroplast") is not None
    assert resolver._try_local("heart anatomy") is not None


@pytest.mark.parametrize("topic", ["computer network", "binary search", "machine learning"])
def test_composed_visuals_explain_relationship_topics(topic):
    svg = _compose_svg(topic)
    assert svg is not None
    assert svg.startswith("<svg")


def test_iot_composition_has_independently_targetable_parts():
    visual = _iot_composition("IoT system")
    assert visual is not None
    assert [part["id"] for part in visual.parts] == [
        "sensor", "microcontroller", "cloud", "actuator"
    ]
    assert "Sensors" in visual.svg
    assert "Network / Cloud" in visual.svg


def test_supporting_visual_keeps_unique_semantic_links_and_full_placement():
    visual = clean_supporting_visual({
        "subject": "IoT system",
        "role": "Shows the data path through the system.",
        "placement": "full",
        "actions": [
            {"action": "PULSE", "target": "sensor"},
            {"action": "PULSE", "target": "sensor"},
            {"action": "FLOW", "target": "sensor -> cloud"},
        ],
        "links": [
            {"point": "Collect data", "target": "sensor"},
            {"point": "Collect data again", "target": "sensor"},
        ],
    })
    assert visual is not None
    assert visual["placement"] == "full"
    assert len(visual["actions"]) == 2
    assert visual["links"] == [{"point": "Collect data", "target": "sensor"}]


def test_serpapi_results_keep_source_backed_findings():
    findings = _serpapi_findings({
        "organic_results": [
            {
                "title": "Official example",
                "link": "https://example.gov/report",
                "snippet": "  A current, source-backed result for the research panel.  ",
            },
            {"title": "Missing URL", "snippet": "This must not be shown."},
        ]
    })
    assert findings == [{
        "point": "A current, source-backed result for the research panel.",
        "source": "Official example",
        "url": "https://example.gov/report",
    }]


@pytest.mark.asyncio
async def test_diagram_note_checkpoint_inherits_concept():
    from board import Board

    board = Board()
    # 1. Diagram drawn -> establishes teaching concept
    await board.add({"id": "x1dia1", "kind": "diagram", "title": "Calvin Cycle", "nodes": []})
    assert board.current.latest_concept_id == "concept-x1dia1"
    assert board.current.elements["x1dia1"]["conceptId"] == "concept-x1dia1"

    # 2. Note added -> must inherit parent concept, NOT change latest_concept_id
    await board.add({"id": "x1txt2", "kind": "text", "text": "ATP and NADPH convert 3-PGA into G3P."})
    assert board.current.elements["x1txt2"]["conceptId"] == "concept-x1dia1"
    assert board.current.latest_concept_id == "concept-x1dia1"

    # 3. Checkpoint emitted -> defaults to shared concept-x1dia1, NOT concept-x1txt2
    cp_op = await board.checkpoint(question="What enzyme catalyzes RuBP fixation?")
    assert cp_op["conceptId"] == "concept-x1dia1"
    assert cp_op["id"] == "cp-concept-x1dia1"


@pytest.mark.asyncio
async def test_ask_checkpoint_playback_emits_ready_on_originating_board():
    import asyncio
    import os
    from board import Board
    from board_session import BoardTeacher
    from locale_map import DEFAULT_PROFILE

    os.environ["GOOGLE_API_KEY"] = "mock-key"

    board = Board()

    class MockClassroom:
        def __init__(self, b):
            self.board = b
            self.profile = DEFAULT_PROFILE
            self.student = "Ravi"
            self.lang = "telugu"
            self.stats = {}
            self.planner = None

    class MockSpeechHandle:
        def __init__(self, speech_id: str = "sp-live-77"):
            self.id = speech_id
            self.interrupted = False
            self.playout_called = False

        async def wait_for_playout(self):
            await asyncio.sleep(0.01)
            self.playout_called = True

    class MockSession:
        def __init__(self, handle):
            self.handle = handle

        def generate_reply(self, instructions: str = ""):
            return self.handle

    cls = MockClassroom(board)
    teacher = BoardTeacher(cls, key="nova")
    handle = MockSpeechHandle("sp-live-77")
    teacher._test_session = MockSession(handle)

    published = []
    async def capture_publish(op, page=None):
        published.append((op, getattr(page, "id", None)))
    board.publish = capture_publish

    # Set up board 1 with concept
    page1 = board.current
    assert page1.id == "b1"
    await board.add({"id": "d1", "kind": "diagram", "title": "Photosynthesis", "conceptId": "concept-photo"})

    # Trigger checkpoint on board 1
    fn = teacher.ask_checkpoint._func
    await fn(teacher, None, question="What are the light reaction products?", concept_id="concept-photo")

    # While playback is in flight, user switches to Board 2!
    await board.new_page("Board 2")
    assert board.current.id == "b2"

    # Wait for playout to complete
    await asyncio.sleep(0.05)

    # 1. SDK method wait_for_playout was actually invoked
    assert handle.playout_called is True

    # 2. Checkpoint activation op targeted board b1 with matching speechId
    cp_activations = [(op, pid) for op, pid in published if op.get("op") == "checkpoint"]
    assert len(cp_activations) == 1
    assert cp_activations[0][0]["speechId"] == "sp-live-77"
    assert cp_activations[0][0]["conceptId"] == "concept-photo"
    assert cp_activations[0][1] == "b1"

    # 3. Checkpoint ready op was emitted targeting originating board b1, NOT b2!
    cp_readies = [(op, pid) for op, pid in published if op.get("op") == "checkpoint_ready"]
    assert len(cp_readies) == 1
    assert cp_readies[0][0]["speechId"] == "sp-live-77"
    assert cp_readies[0][0]["id"] == "cp-concept-photo"
    assert cp_readies[0][0]["conceptId"] == "concept-photo"
    assert cp_readies[0][1] == "b1"


@pytest.mark.asyncio
async def test_ask_checkpoint_structured_options_hints_criteria():
    """Phase 3: ask_checkpoint publishes structured options, hints, and criteria."""
    from board import Board
    from board_session import BoardTeacher
    from locale_map import DEFAULT_PROFILE

    board = Board()
    published = []

    async def capture_publish(op, page=None):
        published.append((op, getattr(page, "id", None)))

    board.publish = capture_publish

    class MockClassroom:
        def __init__(self, b):
            self.board = b
            self.profile = DEFAULT_PROFILE
            self.student = "Ananya"
            self.lang = "english"
            self.stats = {}
            self.planner = None

    cls = MockClassroom(board)
    teacher = BoardTeacher(cls, key="nova")

    fn = teacher.ask_checkpoint._func
    await fn(
        teacher,
        None,
        question="Which organelle conducts photosynthesis?",
        concept_id="concept-organelle",
        options=["Chloroplast", "Mitochondria", "Nucleus"],
        hints=["It contains thylakoid disks", "It gives plant cells their green color"],
        criteria="chloroplast",
    )

    cp_ops = [op for op, _ in published if op.get("op") == "checkpoint"]
    assert len(cp_ops) == 1
    cp = cp_ops[0]
    assert cp["id"] == "cp-concept-organelle"
    assert cp["conceptId"] == "concept-organelle"
    assert cp["question"] == "Which organelle conducts photosynthesis?"
    assert cp["options"] == [
        {"id": "opt-0", "text": "Chloroplast"},
        {"id": "opt-1", "text": "Mitochondria"},
        {"id": "opt-2", "text": "Nucleus"},
    ]
    assert cp["hints"] == ["It contains thylakoid disks", "It gives plant cells their green color"]
    assert cp["criteria"] == "chloroplast"


@pytest.mark.asyncio
async def test_student_checkpoint_response_modalities():
    """Phase 3: student checkpoint responses (voice, typed, chip) share checkpoint ID and are recorded."""
    import json
    from board import Board
    from board_session import MarkRelay
    from locale_map import DEFAULT_PROFILE

    board = Board()

    class MockClassroom:
        def __init__(self, b):
            self.board = b
            self.profile = DEFAULT_PROFILE
            self.student = "Kiran"
            self.lang = "english"
            self.stats = {}
            self.planner = None

    class MockSession:
        current_agent = None
        agent_state = "idle"

    class MockReader:
        def __init__(self, payload: str):
            self._payload = payload

        async def read_all(self):
            return self._payload

    cls = MockClassroom(board)
    relay = MarkRelay(MockSession(), cls)

    # 1. Voice response
    msg_voice = {
        "type": "checkpoint_response",
        "checkpointId": "cp-calvin-cycle",
        "conceptId": "concept-calvin",
        "board": "b1",
        "modality": "voice",
        "response": "RuBisCO fixes CO2",
    }
    await relay.handle(MockReader(json.dumps(msg_voice)), "student-p")
    assert len(relay._held) == 1
    assert "cp-calvin-cycle" in relay._held[0][1]
    assert "voice" in relay._held[0][1]
    assert "RuBisCO fixes CO2" in relay._held[0][1]

    # 2. Typed response
    msg_typed = {
        "type": "checkpoint_response",
        "checkpointId": "cp-calvin-cycle",
        "conceptId": "concept-calvin",
        "board": "b1",
        "modality": "typed",
        "response": "rubisco",
    }
    await relay.handle(MockReader(json.dumps(msg_typed)), "student-p")
    assert len(relay._held) == 2
    assert "cp-calvin-cycle" in relay._held[1][1]
    assert "typed" in relay._held[1][1]
    assert "rubisco" in relay._held[1][1]

    # 3. Chip response
    msg_chip = {
        "type": "checkpoint_response",
        "checkpointId": "cp-calvin-cycle",
        "conceptId": "concept-calvin",
        "board": "b1",
        "modality": "chip",
        "response": "RuBisCO",
    }
    await relay.handle(MockReader(json.dumps(msg_chip)), "student-p")
    assert len(relay._held) == 3
    assert "cp-calvin-cycle" in relay._held[2][1]
    assert "chip" in relay._held[2][1]
    assert "RuBisCO" in relay._held[2][1]


@pytest.mark.asyncio
async def test_board_evaluate_answer_negation_and_options():
    """Phase 3 Regression: Board.evaluate_answer handles negation, out-of-domain options, and answer keys."""
    from board import Board

    board = Board()
    await board.new_page("Photosynthesis")

    # 1. Criteria evaluation with negation check
    await board.checkpoint(
        concept_id="concept-photo",
        question="What green pigment absorbs sunlight?",
        checkpoint_id="cp-photo",
        criteria="chlorophyll",
    )

    # Correct answer containing criteria
    ok, fb = board.evaluate_answer("cp-photo", "Chlorophyll in thylakoid membranes")
    assert ok is True
    assert "Correct" in fb

    # Negated answer containing criteria: must be rejected!
    neg_ok, neg_fb = board.evaluate_answer("cp-photo", "It is not chlorophyll")
    assert neg_ok is False
    assert "negate" in neg_fb.lower()

    # Valid contrasts: must NOT be rejected by negation check!
    contrast1_ok, contrast1_fb = board.evaluate_answer(
        "cp-photo", "Not roots; chlorophyll absorbs light."
    )
    assert contrast1_ok is True
    assert "Correct" in contrast1_fb

    contrast2_ok, contrast2_fb = board.evaluate_answer(
        "cp-photo", "Not roots, but chlorophyll absorbs light."
    )
    assert contrast2_ok is True
    assert "Correct" in contrast2_fb

    # 2. Options and answer key evaluation
    await board.checkpoint(
        concept_id="concept-plant",
        question="Which organ performs photosynthesis?",
        checkpoint_id="cp-plant",
        options=["Roots", "Leaves"],
        answer_key="opt-1",  # Leaves
    )

    # Out of domain answer: "The Moon"
    moon_ok, moon_fb = board.evaluate_answer("cp-plant", "The Moon")
    assert moon_ok is False
    assert "not match any available option" in moon_fb.lower()

    # Wrong valid option: "Roots"
    roots_ok, roots_fb = board.evaluate_answer("cp-plant", "Roots")
    assert roots_ok is False

    # Correct option text: "Leaves"
    leaves_ok, leaves_fb = board.evaluate_answer("cp-plant", "Leaves")
    assert leaves_ok is True
    assert "Correct" in leaves_fb

    # Chip selection by option_id
    chip_correct, _ = board.evaluate_answer("cp-plant", "Leaves", option_id="opt-1")
    assert chip_correct is True

    chip_wrong, _ = board.evaluate_answer("cp-plant", "Roots", option_id="opt-0")
    assert chip_wrong is False

    # 3. Unknown checkpoints and checkpoints without grading criteria return None (pending)
    unknown_ok, unknown_fb = board.evaluate_answer("cp-nonexistent", "Some student response")
    assert unknown_ok is None
    assert "review" in unknown_fb.lower()

    await board.checkpoint(
        concept_id="concept-open",
        question="What do you think happens next?",
        checkpoint_id="cp-open",
    )
    open_ok, open_fb = board.evaluate_answer("cp-open", "Plants might produce starch")
    assert open_ok is None
    assert "review" in open_fb.lower()


@pytest.mark.asyncio
async def test_mark_relay_checkpoint_evaluated_and_teacher_reply():
    """Phase 3 Regression: MarkRelay emits checkpoint_evaluated op and triggers teacher verbal reply."""
    import json
    from board import Board
    from board_session import MarkRelay
    from locale_map import DEFAULT_PROFILE

    board = Board()
    await board.new_page("Cell Biology")
    published = []

    async def mock_publish(op, page=None):
        published.append((op, page))

    board.publish = mock_publish

    await board.checkpoint(
        concept_id="concept-cell",
        question="Where is DNA located?",
        checkpoint_id="cp-cell-dna",
        criteria="nucleus",
    )

    class MockClassroom:
        def __init__(self, b):
            self.board = b
            self.profile = DEFAULT_PROFILE
            self.student = "Kiran"
            self.lang = "en"
            self.stats = {}
            self.planner = None

    class MockTeacher:
        def __init__(self):
            self.chat_ctx = type("Ctx", (), {"copy": lambda self: self, "add_message": lambda *a, **k: None})()

        async def update_chat_ctx(self, ctx):
            pass

    class MockSession:
        def __init__(self):
            self.current_agent = MockTeacher()
            self.agent_state = "idle"
            self.reply_generated = False

        def interrupt(self):
            pass

        def generate_reply(self, instructions=None):
            self.reply_generated = True

    class MockReader:
        def __init__(self, payload: str):
            self._payload = payload

        async def read_all(self):
            return self._payload

    cls = MockClassroom(board)
    sess = MockSession()
    relay = MarkRelay(sess, cls)

    msg = {
        "type": "checkpoint_response",
        "checkpointId": "cp-cell-dna",
        "conceptId": "concept-cell",
        "modality": "typed",
        "response": "Inside the nucleus",
    }
    await relay.handle(MockReader(json.dumps(msg)), "student-p")

    # 1. Emits checkpoint_evaluated op
    eval_ops = [op for op, _ in published if op.get("op") == "checkpoint_evaluated"]
    assert len(eval_ops) == 1
    eval_op = eval_ops[0]
    assert eval_op["checkpointId"] == "cp-cell-dna"
    assert eval_op["isCorrect"] is True
    assert eval_op["criteriaMet"] is True
    assert eval_op["status"] == "evaluated"
    assert "Correct" in eval_op["feedback"]

    # 2. Triggers teacher reply
    assert sess.reply_generated is True

    # 3. Response to ungraded checkpoint emits status="pending" and isCorrect=None
    msg_ungraded = {
        "type": "checkpoint_response",
        "checkpointId": "cp-unknown-check",
        "conceptId": "concept-cell",
        "modality": "typed",
        "response": "Open ended thoughts",
    }
    await relay.handle(MockReader(json.dumps(msg_ungraded)), "student-p")
    eval_ops = [op for op, _ in published if op.get("op") == "checkpoint_evaluated"]
    assert len(eval_ops) == 2
    ungraded_op = eval_ops[1]
    assert ungraded_op["checkpointId"] == "cp-unknown-check"
    assert ungraded_op["isCorrect"] is None
    assert ungraded_op["status"] == "pending"



