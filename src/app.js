import { load as parseYaml } from "js-yaml";
import bundledSpecYaml from "../specs/login.yaml?raw";

const NODE_TYPES = new Set(["view", "action", "command", "integration", "decision", "event", "state"]);
const EDGE_TYPES = new Set(["sequence", "triggers", "produces", "reads", "writes", "requests", "responds", "transitions", "returns"]);
const NODE_PATHS = new Set(["happy", "exception", "both"]);
const DEFAULT_PATHS = new Set(["happy", "exception", "all"]);
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const typeLabels = {
  view: "ビュー",
  action: "操作",
  command: "コマンド",
  integration: "外部連携",
  decision: "判断",
  event: "イベント",
  state: "状態",
};

const edgeTypeLabels = {
  sequence: "順序",
  triggers: "開始",
  produces: "発生",
  reads: "参照",
  writes: "更新",
  requests: "要求",
  responds: "応答",
  transitions: "遷移",
  returns: "戻る",
};

const lanePalette = [
  ["var(--cyan)", "var(--cyan-soft)"],
  ["var(--blue)", "var(--blue-soft)"],
  ["var(--amber)", "var(--amber-soft)"],
  ["var(--plum)", "var(--plum-soft)"],
  ["var(--coral)", "var(--coral-soft)"],
  ["var(--green)", "var(--green-soft)"],
];

let scenario = {};
let lanes = [];
let stories = [];
let nodes = [];
let edges = [];

const state = {
  storyId: null,
  path: "happy",
  level: 2,
  selectedNodeId: null,
  sourceName: "",
};

const laneContainer = document.querySelector("#lane-container");
const edgeLayer = document.querySelector("#edge-layer");
const storyList = document.querySelector("#story-list");
const detailContent = document.querySelector("#detail-content");
const detailPanel = document.querySelector("#detail-panel");
const storyBracket = document.querySelector("#story-bracket");
const flowScroll = document.querySelector("#flow-scroll");
const flowCanvas = document.querySelector("#flow-canvas");
const toast = document.querySelector("#toast");
const specFileInput = document.querySelector("#spec-file-input");
const specError = document.querySelector("#spec-error");

class SpecValidationError extends Error {
  constructor(errors) {
    super("仕様定義に検証エラーがあります");
    this.name = "SpecValidationError";
    this.errors = errors;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function validateSpec(raw) {
  const errors = [];
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

  const objectAt = (value, path) => {
    if (!isObject(value)) {
      errors.push(`${path}: オブジェクトが必要です`);
      return {};
    }
    return value;
  };

  const arrayAt = (value, path, allowEmpty = false) => {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
      errors.push(`${path}: ${allowEmpty ? "配列" : "1件以上の配列"}が必要です`);
      return [];
    }
    return value;
  };

  const stringAt = (value, path) => {
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`${path}: 空でない文字列が必要です`);
      return "";
    }
    return value.trim();
  };

  const idAt = (value, path) => {
    const id = stringAt(value, path);
    if (id && !ID_PATTERN.test(id)) {
      errors.push(`${path}: IDは英字で始まり、英数字・_・-だけを使用してください`);
    }
    return id;
  };

  const enumAt = (value, allowed, path) => {
    if (!allowed.has(value)) {
      errors.push(`${path}: ${[...allowed].join(" / ")} のいずれかが必要です`);
      return [...allowed][0];
    }
    return value;
  };

  const root = objectAt(raw, "root");
  if (root.schemaVersion !== 1) {
    errors.push("schemaVersion: 現在サポートしている値は 1 です");
  }

  const scenarioRaw = objectAt(root.scenario, "scenario");
  const normalizedScenario = {
    id: idAt(scenarioRaw.id, "scenario.id"),
    project: stringAt(scenarioRaw.project, "scenario.project"),
    domain: stringAt(scenarioRaw.domain, "scenario.domain"),
    title: stringAt(scenarioRaw.title, "scenario.title"),
    heading: stringAt(scenarioRaw.heading, "scenario.heading"),
    status: stringAt(scenarioRaw.status, "scenario.status"),
    defaultStory: idAt(scenarioRaw.defaultStory, "scenario.defaultStory"),
    defaultPath: enumAt(scenarioRaw.defaultPath, DEFAULT_PATHS, "scenario.defaultPath"),
    defaultLevel: Number(scenarioRaw.defaultLevel),
    selectedNode: idAt(scenarioRaw.selectedNode, "scenario.selectedNode"),
  };

  if (![1, 2, 3].includes(normalizedScenario.defaultLevel)) {
    errors.push("scenario.defaultLevel: 1 / 2 / 3 のいずれかが必要です");
    normalizedScenario.defaultLevel = 2;
  }

  const normalizedLanes = arrayAt(root.lanes, "lanes").map((laneValue, index) => {
    const lane = objectAt(laneValue, `lanes[${index}]`);
    return {
      id: idAt(lane.id, `lanes[${index}].id`),
      label: stringAt(lane.label, `lanes[${index}].label`),
      code: stringAt(lane.code, `lanes[${index}].code`),
      subtitle: stringAt(lane.subtitle, `lanes[${index}].subtitle`),
    };
  });

  const normalizedStories = arrayAt(root.stories, "stories").map((storyValue, index) => {
    const story = objectAt(storyValue, `stories[${index}]`);
    return {
      id: idAt(story.id, `stories[${index}].id`),
      title: stringAt(story.title, `stories[${index}].title`),
      state: stringAt(story.state, `stories[${index}].state`),
      nodeIds: arrayAt(story.nodes, `stories[${index}].nodes`).map((id, nodeIndex) => idAt(id, `stories[${index}].nodes[${nodeIndex}]`)),
    };
  });

  const normalizedNodes = arrayAt(root.nodes, "nodes").map((nodeValue, index) => {
    const node = objectAt(nodeValue, `nodes[${index}]`);
    const title = objectAt(node.title, `nodes[${index}].title`);
    const detail = objectAt(node.detail, `nodes[${index}].detail`);
    const behavior = objectAt(detail.behavior, `nodes[${index}].detail.behavior`);
    const column = Number(node.column);
    if (!Number.isInteger(column) || column < 1) {
      errors.push(`nodes[${index}].column: 1以上の整数が必要です`);
    }

    return {
      id: idAt(node.id, `nodes[${index}].id`),
      lane: idAt(node.lane, `nodes[${index}].lane`),
      column: Number.isInteger(column) && column > 0 ? column : 1,
      type: enumAt(node.type, NODE_TYPES, `nodes[${index}].type`),
      path: enumAt(node.path, NODE_PATHS, `nodes[${index}].path`),
      title: {
        1: stringAt(title.level1, `nodes[${index}].title.level1`),
        2: stringAt(title.level2, `nodes[${index}].title.level2`),
        3: stringAt(title.level3, `nodes[${index}].title.level3`),
      },
      tech: stringAt(node.technical, `nodes[${index}].technical`),
      description: stringAt(detail.description, `nodes[${index}].detail.description`),
      given: stringAt(behavior.given, `nodes[${index}].detail.behavior.given`),
      when: stringAt(behavior.when, `nodes[${index}].detail.behavior.when`),
      then: stringAt(behavior.then, `nodes[${index}].detail.behavior.then`),
      assumption: stringAt(detail.assumption, `nodes[${index}].detail.assumption`),
      tags: arrayAt(detail.links, `nodes[${index}].detail.links`, true).map((link, linkIndex) => stringAt(link, `nodes[${index}].detail.links[${linkIndex}]`)),
    };
  });

  const normalizedEdges = arrayAt(root.edges, "edges", true).map((edgeValue, index) => {
    const edge = objectAt(edgeValue, `edges[${index}]`);
    return {
      from: idAt(edge.from, `edges[${index}].from`),
      to: idAt(edge.to, `edges[${index}].to`),
      type: enumAt(edge.type, EDGE_TYPES, `edges[${index}].type`),
      path: enumAt(edge.path, NODE_PATHS, `edges[${index}].path`),
      label: edge.label === undefined ? "" : stringAt(edge.label, `edges[${index}].label`),
      loop: edge.loop === true,
    };
  });

  const checkUniqueIds = (items, path) => {
    const seen = new Set();
    items.forEach((item) => {
      if (seen.has(item.id)) errors.push(`${path}: ID「${item.id}」が重複しています`);
      seen.add(item.id);
    });
    return seen;
  };

  const laneIds = checkUniqueIds(normalizedLanes, "lanes");
  const storyIds = checkUniqueIds(normalizedStories, "stories");
  const nodeIds = checkUniqueIds(normalizedNodes, "nodes");

  normalizedNodes.forEach((node) => {
    if (!laneIds.has(node.lane)) errors.push(`nodes.${node.id}.lane: レーン「${node.lane}」が存在しません`);
  });

  normalizedStories.forEach((story) => {
    const duplicateNodeIds = story.nodeIds.filter((id, index) => story.nodeIds.indexOf(id) !== index);
    if (duplicateNodeIds.length) errors.push(`stories.${story.id}.nodes: 同じノードが重複しています`);
    story.nodeIds.forEach((id) => {
      if (!nodeIds.has(id)) errors.push(`stories.${story.id}.nodes: ノード「${id}」が存在しません`);
    });
  });

  normalizedEdges.forEach((edge, index) => {
    if (!nodeIds.has(edge.from)) errors.push(`edges[${index}].from: ノード「${edge.from}」が存在しません`);
    if (!nodeIds.has(edge.to)) errors.push(`edges[${index}].to: ノード「${edge.to}」が存在しません`);
  });

  if (!storyIds.has(normalizedScenario.defaultStory)) {
    errors.push(`scenario.defaultStory: ストーリー「${normalizedScenario.defaultStory}」が存在しません`);
  }
  if (!nodeIds.has(normalizedScenario.selectedNode)) {
    errors.push(`scenario.selectedNode: ノード「${normalizedScenario.selectedNode}」が存在しません`);
  }

  const selectedNode = normalizedNodes.find((node) => node.id === normalizedScenario.selectedNode);
  if (selectedNode && normalizedScenario.defaultPath !== "all" && !["both", normalizedScenario.defaultPath].includes(selectedNode.path)) {
    errors.push("scenario.selectedNode: defaultPathでは非表示になるノードです");
  }
  const defaultStory = normalizedStories.find((story) => story.id === normalizedScenario.defaultStory);
  if (defaultStory && !defaultStory.nodeIds.includes(normalizedScenario.selectedNode)) {
    errors.push("scenario.selectedNode: defaultStoryの範囲に含まれていません");
  }

  if (errors.length) throw new SpecValidationError(errors);

  return {
    schemaVersion: 1,
    scenario: normalizedScenario,
    lanes: normalizedLanes,
    stories: normalizedStories,
    nodes: normalizedNodes,
    edges: normalizedEdges,
  };
}

function applySpec(spec, sourceName) {
  scenario = spec.scenario;
  lanes = spec.lanes;
  stories = spec.stories;
  nodes = spec.nodes;
  edges = spec.edges;
  state.storyId = scenario.defaultStory;
  state.path = scenario.defaultPath;
  state.level = scenario.defaultLevel;
  state.selectedNodeId = scenario.selectedNode;
  state.sourceName = sourceName;

  const maxColumn = Math.max(...nodes.map((node) => node.column), 1);
  flowCanvas.style.setProperty("--column-count", String(maxColumn));
  flowScroll.scrollLeft = 0;
  detailPanel.classList.remove("is-open");

  document.title = `${scenario.title} — Trace`;
  document.querySelector("#scenario-project").textContent = scenario.project;
  document.querySelector("#scenario-domain").textContent = scenario.domain;
  document.querySelector("#scenario-title").textContent = scenario.title;
  document.querySelector("#scenario-status").innerHTML = `<span></span>${escapeHtml(scenario.status)}`;
  document.querySelector("#scenario-eyebrow").textContent = `SCENARIO / ${scenario.id.toUpperCase()}`;
  document.querySelector("#flow-title").textContent = scenario.heading;
  document.querySelector("#story-count").textContent = String(stories.length);
  document.querySelector("#spec-source").textContent = sourceName;
  document.querySelector("#spec-source").title = sourceName;
  document.querySelector("#review-button").innerHTML = '<span class="button-icon" aria-hidden="true">✓</span>レビューを完了';

  document.querySelectorAll("#path-filter button").forEach((button) => {
    const active = button.dataset.path === state.path;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelector("#zoom-level").value = String(state.level);
  document.body.classList.remove("level-1", "level-2", "level-3");
  document.body.classList.add(`level-${state.level}`);

  renderStories();
  renderFlow();
  renderDetail(nodes.find((node) => node.id === state.selectedNodeId));
  showToast(`${sourceName} を読み込みました`);
}

async function loadSpecText(yamlText, sourceName) {
  try {
    const raw = parseYaml(yamlText);
    const spec = validateSpec(raw);
    applySpec(spec, sourceName);
    specError.hidden = true;
    return true;
  } catch (error) {
    showSpecError(error, sourceName);
    return false;
  }
}

function showSpecError(error, sourceName) {
  const errors = error instanceof SpecValidationError
    ? error.errors
    : [formatYamlError(error)];
  document.querySelector("#spec-error-source").textContent = sourceName;
  document.querySelector("#spec-error-list").innerHTML = errors
    .slice(0, 12)
    .map((message) => `<li>${escapeHtml(message)}</li>`)
    .join("");
  specError.hidden = false;
}

function formatYamlError(error) {
  if (error?.mark) {
    return `YAML ${error.mark.line + 1}行 ${error.mark.column + 1}列: ${error.reason ?? error.message}`;
  }
  return error?.message ?? "YAMLを読み込めませんでした";
}

function getVisibleNodes() {
  return nodes.filter((node) => {
    if (state.path === "all") return true;
    return node.path === "both" || node.path === state.path;
  });
}

function renderStories() {
  storyList.innerHTML = stories
    .map((story) => `
      <button class="story-card ${story.id === state.storyId ? "is-active" : ""}" type="button" data-story-id="${escapeHtml(story.id)}" aria-pressed="${story.id === state.storyId}">
        <span class="story-meta"><span>${escapeHtml(story.id)}</span><span class="story-state">${escapeHtml(story.state)}</span></span>
        <p>${escapeHtml(story.title)}</p>
        <small>${story.nodeIds.length} ノードに接続</small>
      </button>
    `)
    .join("");

  storyList.querySelectorAll(".story-card").forEach((button) => {
    button.addEventListener("click", () => {
      state.storyId = button.dataset.storyId;
      const selectedStory = stories.find((story) => story.id === state.storyId);
      const visibleIds = new Set(getVisibleNodes().map((node) => node.id));
      if (!selectedStory.nodeIds.includes(state.selectedNodeId)) {
        state.selectedNodeId = selectedStory.nodeIds.find((id) => visibleIds.has(id)) ?? null;
        renderDetail(nodes.find((node) => node.id === state.selectedNodeId));
      }
      document.querySelectorAll(".flow-node").forEach((nodeButton) => {
        nodeButton.classList.toggle("is-selected", nodeButton.dataset.nodeId === state.selectedNodeId);
      });
      renderStories();
      updateScope();
      requestAnimationFrame(drawEdges);
    });
  });
}

function renderFlow() {
  const visibleNodes = getVisibleNodes();
  laneContainer.innerHTML = lanes
    .map((lane, laneIndex) => {
      const laneNodes = visibleNodes
        .filter((node) => node.lane === lane.id)
        .map((node) => renderNodeSlot(node))
        .join("");

      const [laneColor, laneSoft] = lanePalette[laneIndex % lanePalette.length];
      return `
        <div class="lane lane-${escapeHtml(lane.id)}" data-lane-id="${escapeHtml(lane.id)}" style="--lane-color: ${laneColor}; --lane-soft: ${laneSoft}">
          <div class="lane-label">
            <span class="lane-stamp">${escapeHtml(lane.code)}</span>
            <span><strong>${escapeHtml(lane.label)}</strong><small>${escapeHtml(lane.subtitle)}</small></span>
          </div>
          ${laneNodes}
        </div>
      `;
    })
    .join("");

  document.querySelectorAll(".flow-node").forEach((button) => {
    button.addEventListener("click", () => selectNode(button.dataset.nodeId));
  });

  updateScope();
  updateFlowSummary();
  requestAnimationFrame(() => requestAnimationFrame(drawEdges));
}

function renderNodeSlot(node) {
  const title = node.title[state.level];
  const branchCount = edges.filter((edge) => edge.from === node.id).length;
  return `
    <div class="node-slot" style="grid-column: ${node.column + 1}" data-slot-id="${escapeHtml(node.id)}">
      <button
        type="button"
        class="flow-node ${node.id === state.selectedNodeId ? "is-selected" : ""}"
        data-node-id="${escapeHtml(node.id)}"
        data-type="${escapeHtml(node.type)}"
        data-path="${escapeHtml(node.path)}"
        aria-label="${escapeHtml(typeLabels[node.type])}: ${escapeHtml(title)}"
      >
        <span class="node-topline">
          <span class="node-type">${escapeHtml(typeLabels[node.type])}</span>
          <span class="node-step">${String(node.column).padStart(2, "0")}</span>
        </span>
        <strong>${escapeHtml(title)}</strong>
        <span class="node-detail">${escapeHtml(node.tech)}</span>
        ${node.type === "decision" ? `<span class="decision-branch">${branchCount} PATHS</span>` : ""}
      </button>
    </div>
  `;
}

function updateScope() {
  const story = stories.find((item) => item.id === state.storyId);
  if (!story) return;
  const visibleNodes = getVisibleNodes();
  const visibleScopeIds = story.nodeIds.filter((id) => visibleNodes.some((node) => node.id === id));

  document.querySelectorAll(".flow-node").forEach((button) => {
    const inScope = story.nodeIds.includes(button.dataset.nodeId);
    button.classList.toggle("is-in-scope", inScope);
    button.classList.toggle("is-muted", !inScope);
  });

  const percentage = Math.round((visibleScopeIds.length / story.nodeIds.length) * 100);
  document.querySelector("#coverage-value").textContent = `${percentage}%`;
  document.querySelector("#coverage-bar").style.width = `${percentage}%`;
  document.querySelector("#coverage-caption").textContent = `${visibleScopeIds.length} / ${story.nodeIds.length} ノードを表示中`;
  updateBracket(story, visibleScopeIds);
}

function updateBracket(story, visibleScopeIds) {
  const elements = visibleScopeIds
    .map((id) => document.querySelector(`[data-node-id="${CSS.escape(id)}"]`))
    .filter(Boolean);

  if (!elements.length) {
    storyBracket.style.opacity = "0";
    return;
  }

  const canvasRect = flowCanvas.getBoundingClientRect();
  const rects = elements.map((element) => element.getBoundingClientRect());
  const left = Math.min(...rects.map((rect) => rect.left)) - canvasRect.left - 5;
  const right = Math.max(...rects.map((rect) => rect.right)) - canvasRect.left + 5;
  storyBracket.style.left = `${left}px`;
  storyBracket.style.width = `${right - left}px`;
  storyBracket.style.opacity = "1";
  storyBracket.querySelector("span").textContent = `${story.id} CHANGE SCOPE`;
}

function selectNode(nodeId) {
  state.selectedNodeId = nodeId;
  document.querySelectorAll(".flow-node").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.nodeId === nodeId);
  });
  renderDetail(nodes.find((node) => node.id === nodeId));
  detailPanel.classList.add("is-open");
  requestAnimationFrame(drawEdges);
}

function renderDetail(node) {
  if (!node) {
    detailContent.innerHTML = `
      <div class="detail-empty">
        <div>
          <div class="detail-empty-icon" aria-hidden="true"></div>
          <h2 id="detail-title">ノードを選択</h2>
          <p>フロー上の要素を選ぶと、前提・振る舞い・仮定をここで確認できます。</p>
        </div>
      </div>
    `;
    return;
  }

  detailContent.innerHTML = `
    <div class="detail-header">
      <div class="detail-type"><span></span>${escapeHtml(typeLabels[node.type])}</div>
      <h2 id="detail-title">${escapeHtml(node.title[state.level])}</h2>
      <p class="detail-description">${escapeHtml(node.description)}</p>
      <code class="detail-id">${escapeHtml(node.id)}</code>
    </div>

    <section class="detail-section">
      <h3>Behavior specification</h3>
      <dl class="gwt-list">
        <dt>GIVEN</dt><dd>${escapeHtml(node.given)}</dd>
        <dt>WHEN</dt><dd>${escapeHtml(node.when)}</dd>
        <dt>THEN</dt><dd>${escapeHtml(node.then)}</dd>
      </dl>
    </section>

    <section class="detail-section">
      <h3>Assumption</h3>
      <div class="assumption-card">${escapeHtml(node.assumption)}</div>
    </section>

    <section class="detail-section">
      <h3>Trace links</h3>
      <div class="tag-list">${node.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
    </section>

    <section class="detail-section">
      <h3>Technical mapping</h3>
      <div class="tag-list"><span class="tag">${escapeHtml(node.tech)}</span></div>
    </section>
  `;
}

function drawEdges() {
  const svgRect = edgeLayer.getBoundingClientRect();
  edgeLayer.setAttribute("viewBox", `0 0 ${svgRect.width} ${svgRect.height}`);
  edgeLayer.querySelectorAll(".edge-path, .edge-foreign").forEach((element) => element.remove());

  const story = stories.find((item) => item.id === state.storyId);
  if (!story) return;
  const visibleIds = new Set(getVisibleNodes().map((node) => node.id));

  edges.forEach((edge) => {
    if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) return;
    if (state.path !== "all" && edge.path !== "both" && edge.path !== state.path) return;

    const from = document.querySelector(`[data-node-id="${CSS.escape(edge.from)}"]`);
    const to = document.querySelector(`[data-node-id="${CSS.escape(edge.to)}"]`);
    if (!from || !to) return;

    const fromRect = from.getBoundingClientRect();
    const toRect = to.getBoundingClientRect();
    const inScope = story.nodeIds.includes(edge.from) && story.nodeIds.includes(edge.to);
    const selected = edge.from === state.selectedNodeId || edge.to === state.selectedNodeId;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

    let x1 = fromRect.right - svgRect.left;
    let y1 = fromRect.top + fromRect.height / 2 - svgRect.top;
    let x2 = toRect.left - svgRect.left;
    let y2 = toRect.top + toRect.height / 2 - svgRect.top;
    let d;

    if (edge.loop) {
      x1 = fromRect.left + fromRect.width / 2 - svgRect.left;
      y1 = fromRect.bottom - svgRect.top;
      x2 = toRect.left + toRect.width / 2 - svgRect.left;
      y2 = toRect.top - svgRect.top;
      const loopY = Math.max(fromRect.bottom, toRect.bottom) - svgRect.top + 38;
      d = `M ${x1} ${y1} C ${x1} ${loopY}, ${x2} ${loopY}, ${x2} ${y2}`;
    } else {
      const bend = Math.max(32, Math.abs(x2 - x1) * 0.42);
      d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
    }

    path.setAttribute("d", d);
    path.setAttribute("class", `edge-path edge-${edge.type} ${!inScope ? "is-muted" : ""} ${edge.path === "exception" ? "is-exception" : ""}`);
    if (selected) path.style.strokeWidth = "2.6";
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${edge.from} → ${edge.to}（${edgeTypeLabels[edge.type]}）`;
    path.appendChild(title);
    edgeLayer.appendChild(path);

    if (edge.label) {
      const foreign = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
      const midX = (x1 + x2) / 2 - 20;
      const midY = (y1 + y2) / 2 - 13;
      foreign.setAttribute("x", midX);
      foreign.setAttribute("y", midY);
      foreign.setAttribute("width", "40");
      foreign.setAttribute("height", "24");
      foreign.setAttribute("class", "edge-foreign");
      foreign.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="edge-label">${escapeHtml(edge.label)}</div>`;
      edgeLayer.appendChild(foreign);
    }
  });
}

function updateFlowSummary() {
  const visibleNodes = getVisibleNodes();
  document.querySelector("#flow-summary").innerHTML = `
    <span><b>${visibleNodes.length}</b> ノード</span>
    <span><b>${lanes.length}</b> レーン</span>
    <span><b>${visibleNodes.filter((node) => node.type === "decision").length}</b> 判断</span>
  `;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

document.querySelectorAll("#path-filter button").forEach((button) => {
  button.addEventListener("click", () => {
    state.path = button.dataset.path;
    document.querySelectorAll("#path-filter button").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    renderFlow();
    const selectedStillVisible = getVisibleNodes().some((node) => node.id === state.selectedNodeId);
    if (!selectedStillVisible) {
      state.selectedNodeId = null;
      renderDetail(null);
    }
  });
});

document.querySelector("#zoom-level").addEventListener("change", (event) => {
  state.level = Number(event.target.value);
  document.body.classList.remove("level-1", "level-2", "level-3");
  document.body.classList.add(`level-${state.level}`);
  renderFlow();
  renderDetail(nodes.find((node) => node.id === state.selectedNodeId));
});

document.querySelector("#fit-button").addEventListener("click", () => {
  flowScroll.scrollTo({ left: 0, behavior: "smooth" });
  showToast("フローの先頭へ移動しました");
});

document.querySelector("#load-spec-button").addEventListener("click", () => specFileInput.click());
specFileInput.addEventListener("change", async () => {
  const [file] = specFileInput.files;
  if (!file) return;
  await loadSpecText(await file.text(), file.name);
  specFileInput.value = "";
});

document.addEventListener("dragover", (event) => {
  if ([...event.dataTransfer.types].includes("Files")) event.preventDefault();
});
document.addEventListener("drop", async (event) => {
  const [file] = [...event.dataTransfer.files];
  if (!file || !/\.(ya?ml|json)$/i.test(file.name)) return;
  event.preventDefault();
  await loadSpecText(await file.text(), file.name);
});

document.querySelector("#spec-error-close").addEventListener("click", () => {
  specError.hidden = true;
});
document.querySelector("#detail-close").addEventListener("click", () => detailPanel.classList.remove("is-open"));

const legend = document.querySelector("#legend-popover");
document.querySelector("#help-button").addEventListener("click", () => {
  legend.hidden = !legend.hidden;
});
document.querySelector("#legend-close").addEventListener("click", () => {
  legend.hidden = true;
});

document.querySelector("#review-button").addEventListener("click", (event) => {
  event.currentTarget.innerHTML = '<span class="button-icon" aria-hidden="true">✓</span>レビュー済み';
  document.querySelector("#scenario-status").innerHTML = "<span></span>レビュー完了";
  showToast("このシナリオをレビュー済みにしました");
});

document.querySelector("#annotation-button").addEventListener("click", () => showToast("注釈パネルは次のプロトタイプで接続します"));

let dragStart = null;
flowScroll.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  dragStart = { x: event.clientX, left: flowScroll.scrollLeft };
  flowScroll.setPointerCapture(event.pointerId);
  flowScroll.classList.add("is-dragging");
});

flowScroll.addEventListener("pointermove", (event) => {
  if (!dragStart) return;
  flowScroll.scrollLeft = dragStart.left - (event.clientX - dragStart.x);
});

flowScroll.addEventListener("pointerup", () => {
  dragStart = null;
  flowScroll.classList.remove("is-dragging");
});

flowScroll.addEventListener("scroll", () => {
  document.querySelector("#scroll-hint").style.opacity = flowScroll.scrollLeft > 40 ? "0" : "1";
  requestAnimationFrame(drawEdges);
}, { passive: true });

window.addEventListener("resize", () => requestAnimationFrame(drawEdges));

async function bootstrap() {
  const specUrl = new URLSearchParams(window.location.search).get("spec");
  if (specUrl) {
    try {
      const response = await fetch(specUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const loaded = await loadSpecText(await response.text(), specUrl);
      if (loaded) return;
    } catch (error) {
      showSpecError(new Error(`指定された仕様を取得できません: ${error.message}`), specUrl);
    }
  }
  await loadSpecText(bundledSpecYaml, "specs/login.yaml");
}

bootstrap();
