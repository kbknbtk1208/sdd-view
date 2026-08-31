import { load as parseYaml } from "js-yaml";
import bundledSpecYaml from "../specs/login.yaml?raw";

const NODE_TYPES = new Set(["view", "action", "command", "integration", "decision", "event", "state"]);
const EXPERIENCE_NODE_TYPES = new Set(["view", "action", "event", "state"]);
const EDGE_TYPES = new Set(["sequence", "triggers", "produces", "reads", "writes", "requests", "responds", "transitions", "returns", "enables"]);
const NODE_PATHS = new Set(["happy", "exception", "both"]);
const DEFAULT_PATHS = new Set(["happy", "exception", "all"]);
const SUBFLOW_KINDS = new Set(["interaction", "orchestration"]);
const GROUP_MODES = new Set(["unordered", "parallel"]);
const JOIN_MODES = new Set(["all", "any"]);
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
  enables: "有効化",
};

const subflowKindLabels = {
  interaction: "INTERACTION",
  orchestration: "ORCHESTRATION",
};

const groupModeLabels = {
  unordered: "ANY ORDER",
  parallel: "PARALLEL",
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
let subflows = [];

const state = {
  storyId: null,
  path: "happy",
  selectedNodeId: null,
  sourceName: "",
  activeSubflowId: null,
  activeSubflowParentId: null,
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
const subflowOverlay = document.querySelector("#subflow-overlay");
const subflowDialog = document.querySelector(".subflow-dialog");
const subflowDialogHeader = document.querySelector(".subflow-dialog-header");
const subflowDialogBody = document.querySelector("#subflow-dialog-body");
const subflowDialogClose = document.querySelector("#subflow-dialog-close");
const subflowResizeHandle = document.querySelector("#subflow-resize-handle");
let lastSubflowTrigger = null;
let subflowPanelPosition = null;
let subflowPanelSize = null;
let subflowDragState = null;
let subflowResizeState = null;
let subflowEdgeFrame = null;
const PANEL_GUTTER = 10;
const PANEL_GAP = 10;
const PANEL_MIN_WIDTH = 440;
const PANEL_MIN_HEIGHT = 260;

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

function assignAutoColumns(nodeList, edgeList) {
  const nodeById = new Map(nodeList.map((node) => [node.id, node]));
  const sourceOrder = new Map(nodeList.map((node, index) => [node.id, index]));
  const incomingCount = new Map(nodeList.map((node) => [node.id, 0]));
  const outgoing = new Map(nodeList.map((node) => [node.id, []]));
  const rank = new Map(nodeList.map((node) => [node.id, 1]));

  edgeList
    .filter((edge) => !edge.loop && nodeById.has(edge.from) && nodeById.has(edge.to))
    .forEach((edge) => {
      outgoing.get(edge.from).push(edge.to);
      incomingCount.set(edge.to, incomingCount.get(edge.to) + 1);
    });

  const queue = nodeList
    .filter((node) => incomingCount.get(node.id) === 0)
    .map((node) => node.id);
  const processed = new Set();

  while (queue.length) {
    queue.sort((left, right) => sourceOrder.get(left) - sourceOrder.get(right));
    const currentId = queue.shift();
    processed.add(currentId);
    outgoing.get(currentId).forEach((nextId) => {
      rank.set(nextId, Math.max(rank.get(nextId), rank.get(currentId) + 1));
      incomingCount.set(nextId, incomingCount.get(nextId) - 1);
      if (incomingCount.get(nextId) === 0) queue.push(nextId);
    });
  }

  nodeList.forEach((node, index) => {
    node.column = processed.has(node.id) ? rank.get(node.id) : index + 1;
  });
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

  const optionalIdAt = (value, path) => {
    if (value === undefined) return "";
    return idAt(value, path);
  };

  const normalizeNode = (nodeValue, path, placementKey) => {
    const node = objectAt(nodeValue, path);
    const detail = objectAt(node.detail, `${path}.detail`);
    const behavior = objectAt(detail.behavior, `${path}.detail.behavior`);
    const nodePath = enumAt(node.path, NODE_PATHS, `${path}.path`);

    return {
      id: idAt(node.id, `${path}.id`),
      lane: placementKey === "experience" ? (nodePath === "exception" ? "exception" : "experience") : "",
      track: placementKey === "track" ? idAt(node.track, `${path}.track`) : "",
      column: 1,
      type: enumAt(node.type, placementKey === "experience" ? EXPERIENCE_NODE_TYPES : NODE_TYPES, `${path}.type`),
      path: nodePath,
      expands: optionalIdAt(node.expands, `${path}.expands`),
      join: node.join === undefined ? "" : enumAt(node.join, JOIN_MODES, `${path}.join`),
      title: stringAt(node.title, `${path}.title`),
      tech: stringAt(node.technical, `${path}.technical`),
      description: stringAt(detail.description, `${path}.detail.description`),
      given: stringAt(behavior.given, `${path}.detail.behavior.given`),
      when: stringAt(behavior.when, `${path}.detail.behavior.when`),
      then: stringAt(behavior.then, `${path}.detail.behavior.then`),
      assumption: stringAt(detail.assumption, `${path}.detail.assumption`),
      tags: arrayAt(detail.links, `${path}.detail.links`, true).map((link, linkIndex) => stringAt(link, `${path}.detail.links[${linkIndex}]`)),
      parentId: "",
      subflowId: "",
      isChild: placementKey === "track",
    };
  };

  const normalizeEdge = (edgeValue, path) => {
    const edge = objectAt(edgeValue, path);
    return {
      from: idAt(edge.from, `${path}.from`),
      to: idAt(edge.to, `${path}.to`),
      type: enumAt(edge.type, EDGE_TYPES, `${path}.type`),
      path: enumAt(edge.path, NODE_PATHS, `${path}.path`),
      label: edge.label === undefined ? "" : stringAt(edge.label, `${path}.label`),
      loop: edge.loop === true,
    };
  };

  const root = objectAt(raw, "root");
  if (root.schemaVersion !== 3) {
    throw new SpecValidationError(["schemaVersion: 現在サポートしている値は 3 です"]);
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
    selectedNode: idAt(scenarioRaw.selectedNode, "scenario.selectedNode"),
  };

  const normalizedLanes = [
    { id: "experience", label: "ユーザー", code: "UX", subtitle: "experience" },
    { id: "exception", label: "エラー時", code: "EX", subtitle: "recovery" },
  ];

  const normalizedStories = arrayAt(root.stories, "stories").map((storyValue, index) => {
    const story = objectAt(storyValue, `stories[${index}]`);
    return {
      id: idAt(story.id, `stories[${index}].id`),
      title: stringAt(story.title, `stories[${index}].title`),
      state: stringAt(story.state, `stories[${index}].state`),
      nodeIds: arrayAt(story.nodes, `stories[${index}].nodes`).map((id, nodeIndex) => idAt(id, `stories[${index}].nodes[${nodeIndex}]`)),
    };
  });

  const experienceRaw = objectAt(root.experience, "experience");
  const normalizedNodes = arrayAt(experienceRaw.nodes, "experience.nodes").map((nodeValue, index) => normalizeNode(nodeValue, `experience.nodes[${index}]`, "experience"));
  const normalizedEdges = arrayAt(experienceRaw.edges, "experience.edges", true).map((edgeValue, index) => normalizeEdge(edgeValue, `experience.edges[${index}]`));

  const subflowsRaw = objectAt(root.subflows, "subflows");
  const normalizedSubflows = Object.entries(subflowsRaw).map(([subflowKey, subflowValue]) => {
    const path = `subflows.${subflowKey}`;
    const subflow = objectAt(subflowValue, path);
    const tracks = arrayAt(subflow.tracks, `${path}.tracks`).map((trackValue, index) => {
      const track = objectAt(trackValue, `${path}.tracks[${index}]`);
      return {
        id: idAt(track.id, `${path}.tracks[${index}].id`),
        label: stringAt(track.label, `${path}.tracks[${index}].label`),
        code: stringAt(track.code, `${path}.tracks[${index}].code`),
      };
    });
    const groupsRaw = objectAt(subflow.groups, `${path}.groups`);
    const groups = Object.entries(groupsRaw).map(([groupKey, groupValue]) => {
      const groupPath = `${path}.groups.${groupKey}`;
      const group = objectAt(groupValue, groupPath);
      return {
        id: idAt(groupKey, groupPath),
        label: stringAt(group.label, `${groupPath}.label`),
        mode: enumAt(group.mode, GROUP_MODES, `${groupPath}.mode`),
        members: arrayAt(group.members, `${groupPath}.members`).map((memberId, index) => idAt(memberId, `${groupPath}.members[${index}]`)),
      };
    });
    const exitsRaw = objectAt(subflow.exits, `${path}.exits`);

    return {
      id: idAt(subflowKey, path),
      kind: enumAt(subflow.kind, SUBFLOW_KINDS, `${path}.kind`),
      title: stringAt(subflow.title, `${path}.title`),
      summary: stringAt(subflow.summary, `${path}.summary`),
      tracks,
      groups,
      entry: arrayAt(subflow.entry, `${path}.entry`).map((nodeId, index) => idAt(nodeId, `${path}.entry[${index}]`)),
      exits: {
        happy: arrayAt(exitsRaw.happy, `${path}.exits.happy`, true).map((nodeId, index) => idAt(nodeId, `${path}.exits.happy[${index}]`)),
        exception: arrayAt(exitsRaw.exception, `${path}.exits.exception`, true).map((nodeId, index) => idAt(nodeId, `${path}.exits.exception[${index}]`)),
      },
      nodes: arrayAt(subflow.nodes, `${path}.nodes`).map((nodeValue, index) => normalizeNode(nodeValue, `${path}.nodes[${index}]`, "track")),
      edges: arrayAt(subflow.edges, `${path}.edges`, true).map((edgeValue, index) => normalizeEdge(edgeValue, `${path}.edges[${index}]`)),
      parentId: "",
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
  const subflowIds = checkUniqueIds(normalizedSubflows, "subflows");

  normalizedNodes.forEach((node) => {
    if (!laneIds.has(node.lane)) errors.push(`nodes.${node.id}.lane: レーン「${node.lane}」が存在しません`);
    if (!node.expands) return;
    const subflow = normalizedSubflows.find((item) => item.id === node.expands);
    if (!subflowIds.has(node.expands)) {
      errors.push(`nodes.${node.id}.expands: サブフロー「${node.expands}」が存在しません`);
      return;
    }
    if (subflow.parentId) {
      errors.push(`subflows.${subflow.id}: 複数の親ノードから参照されています`);
      return;
    }
    subflow.parentId = node.id;
    subflow.nodes.forEach((childNode) => {
      childNode.parentId = node.id;
      childNode.subflowId = subflow.id;
    });
  });

  normalizedSubflows.forEach((subflow) => {
    if (!subflow.parentId) errors.push(`subflows.${subflow.id}: expandsで参照する親ノードが必要です`);
    const trackIds = checkUniqueIds(subflow.tracks, `subflows.${subflow.id}.tracks`);
    checkUniqueIds(subflow.nodes, `subflows.${subflow.id}.nodes`);
    const childIds = new Set(subflow.nodes.map((node) => node.id));
    checkUniqueIds(subflow.groups, `subflows.${subflow.id}.groups`);
    subflow.nodes.forEach((node) => {
      if (!trackIds.has(node.track)) {
        errors.push(`subflows.${subflow.id}.nodes.${node.id}.track: トラック「${node.track}」が存在しません`);
      }
      if (node.expands) {
        errors.push(`subflows.${subflow.id}.nodes.${node.id}.expands: 現在のビューは2階層目の展開に対応していません`);
      }
      if (node.join === "all") {
        const incomingCount = subflow.edges.filter((edge) => !edge.loop && edge.to === node.id).length;
        if (incomingCount < 2) errors.push(`subflows.${subflow.id}.nodes.${node.id}.join: allには2本以上の入力エッジが必要です`);
      }
    });
    subflow.groups.forEach((group) => {
      const duplicateMembers = group.members.filter((id, index) => group.members.indexOf(id) !== index);
      if (duplicateMembers.length) errors.push(`subflows.${subflow.id}.groups.${group.id}.members: 同じノードが重複しています`);
      group.members.forEach((nodeId) => {
        if (!childIds.has(nodeId)) errors.push(`subflows.${subflow.id}.groups.${group.id}.members: 子ノード「${nodeId}」が存在しません`);
      });
    });
    [...subflow.entry, ...subflow.exits.happy, ...subflow.exits.exception].forEach((nodeId) => {
      if (!childIds.has(nodeId)) errors.push(`subflows.${subflow.id}: entry/exitsの子ノード「${nodeId}」が存在しません`);
    });
    subflow.edges.forEach((edge, index) => {
      if (!childIds.has(edge.from)) errors.push(`subflows.${subflow.id}.edges[${index}].from: 子ノード「${edge.from}」が存在しません`);
      if (!childIds.has(edge.to)) errors.push(`subflows.${subflow.id}.edges[${index}].to: 子ノード「${edge.to}」が存在しません`);
    });
  });

  const allNodes = [...normalizedNodes, ...normalizedSubflows.flatMap((subflow) => subflow.nodes)];
  const allNodeIds = checkUniqueIds(allNodes, "nodes + subflows.nodes");

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
  if (!allNodeIds.has(normalizedScenario.selectedNode)) {
    errors.push(`scenario.selectedNode: ノード「${normalizedScenario.selectedNode}」が存在しません`);
  }

  const selectedNode = allNodes.find((node) => node.id === normalizedScenario.selectedNode);
  if (selectedNode && normalizedScenario.defaultPath !== "all" && !["both", normalizedScenario.defaultPath].includes(selectedNode.path)) {
    errors.push("scenario.selectedNode: defaultPathでは非表示になるノードです");
  }
  const defaultStory = normalizedStories.find((story) => story.id === normalizedScenario.defaultStory);
  const selectedScopeId = selectedNode?.isChild ? selectedNode.parentId : selectedNode?.id;
  if (defaultStory && !defaultStory.nodeIds.includes(selectedScopeId)) {
    errors.push("scenario.selectedNode: defaultStoryの範囲に含まれていません");
  }

  assignAutoColumns(normalizedNodes, normalizedEdges);
  normalizedSubflows.forEach((subflow) => assignAutoColumns(subflow.nodes, subflow.edges));

  if (errors.length) throw new SpecValidationError(errors);

  return {
    schemaVersion: 3,
    scenario: normalizedScenario,
    lanes: normalizedLanes,
    stories: normalizedStories,
    nodes: normalizedNodes,
    edges: normalizedEdges,
    subflows: normalizedSubflows,
  };
}

function applySpec(spec, sourceName) {
  scenario = spec.scenario;
  lanes = spec.lanes;
  stories = spec.stories;
  nodes = spec.nodes;
  edges = spec.edges;
  subflows = spec.subflows;
  state.storyId = scenario.defaultStory;
  state.path = scenario.defaultPath;
  state.selectedNodeId = scenario.selectedNode;
  state.sourceName = sourceName;
  state.activeSubflowId = null;
  state.activeSubflowParentId = null;
  lastSubflowTrigger = null;

  const maxColumn = Math.max(...nodes.map((node) => node.column), 1);
  flowCanvas.style.setProperty("--column-count", String(maxColumn));
  flowScroll.scrollLeft = 0;
  detailPanel.classList.remove("is-open");
  closeSubflowPanel({ restoreFocus: false });

  document.title = `${scenario.title} — Trace`;
  document.querySelector("#scenario-project").textContent = scenario.project;
  document.querySelector("#scenario-domain").textContent = scenario.domain;
  document.querySelector("#scenario-title").textContent = scenario.title;
  document.querySelector("#scenario-status").innerHTML = `<span></span>${escapeHtml(scenario.status)}`;
  document.querySelector("#scenario-eyebrow").textContent = `EXPERIENCE / ${scenario.id.toUpperCase()}`;
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
  renderStories();
  renderFlow();
  renderDetail(getNodeById(state.selectedNodeId));
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

function isVisibleByPath(item) {
  return state.path === "all" || item.path === "both" || item.path === state.path;
}

function getVisibleNodes(candidates = nodes) {
  return candidates.filter(isVisibleByPath);
}

function getSubflow(subflowId) {
  return subflows.find((subflow) => subflow.id === subflowId);
}

function getNodeById(nodeId) {
  if (!nodeId) return null;
  return nodes.find((node) => node.id === nodeId)
    ?? subflows.flatMap((subflow) => subflow.nodes).find((node) => node.id === nodeId)
    ?? null;
}

function getParentNode(node) {
  if (!node) return null;
  return node.isChild
    ? nodes.find((candidate) => candidate.id === node.parentId) ?? null
    : node;
}

function isNodeInStory(nodeId, story) {
  const node = getNodeById(nodeId);
  if (!node || !story) return false;
  return story.nodeIds.includes(node.isChild ? node.parentId : node.id);
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
      const activeSubflow = getSubflow(state.activeSubflowId);
      if (activeSubflow && !selectedStory.nodeIds.includes(activeSubflow.parentId)) closeSubflowPanel();
      const visibleIds = new Set(getVisibleNodes().map((node) => node.id));
      if (!isNodeInStory(state.selectedNodeId, selectedStory)) {
        state.selectedNodeId = selectedStory.nodeIds.find((id) => visibleIds.has(id)) ?? null;
        renderDetail(getNodeById(state.selectedNodeId));
      }
      document.querySelectorAll(".flow-node, .subflow-node").forEach((nodeButton) => {
        nodeButton.classList.toggle("is-selected", nodeButton.dataset.nodeId === state.selectedNodeId);
      });
      renderStories();
      updateScope();
      renderActiveSubflow();
      requestAnimationFrame(drawEdges);
    });
  });
}

function renderFlow() {
  const visibleNodes = getVisibleNodes();
  const maxColumn = Math.max(...visibleNodes.map((node) => node.column), 1);
  flowCanvas.style.setProperty("--column-count", String(maxColumn));
  const activeLanes = lanes.filter((lane) => visibleNodes.some((node) => node.lane === lane.id));
  laneContainer.innerHTML = activeLanes
    .map((lane, laneIndex) => {
      const laneNodes = visibleNodes
        .filter((node) => node.lane === lane.id)
        .map((node) => renderNodeSlot(node))
        .join("");

      const [laneColor, laneSoft] = lane.id === "exception"
        ? ["var(--coral)", "var(--coral-soft)"]
        : lanePalette[laneIndex % lanePalette.length];
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

  bindFlowInteractions();
  updateScope();
  updateFlowSummary();
  renderActiveSubflow();
  requestAnimationFrame(() => requestAnimationFrame(drawEdges));
}

function renderNodeSlot(node) {
  const title = node.title;
  const branchCount = edges.filter((edge) => edge.from === node.id).length;
  const subflow = getSubflow(node.expands);
  const commonClasses = `${node.id === state.selectedNodeId ? "is-selected" : ""} ${subflow ? "has-subflow" : ""}`;
  return `
    <div class="node-slot" style="grid-column: ${node.column + 1}" data-slot-id="${escapeHtml(node.id)}">
      <article
        class="flow-node ${commonClasses}"
        data-node-id="${escapeHtml(node.id)}"
        data-top-node-id="${escapeHtml(node.id)}"
        data-type="${escapeHtml(node.type)}"
        data-path="${escapeHtml(node.path)}"
      >
        <button
          type="button"
          class="node-main"
          data-select-node="${escapeHtml(node.id)}"
          aria-label="${escapeHtml(typeLabels[node.type])}: ${escapeHtml(title)}"
        >
          ${renderNodeCardContent(node, title, branchCount)}
        </button>
        ${subflow ? `
          <button class="compound-teaser" type="button" data-toggle-node="${escapeHtml(node.id)}" aria-label="${escapeHtml(title)}の詳細を見る">
            <span aria-hidden="true">↳</span>
            <b>${subflow.kind === "interaction" ? "画面内の動き" : "システムの動き"}</b>
            <span>詳細を見る</span>
          </button>
        ` : ""}
      </article>
    </div>
  `;
}

function renderNodeCardContent(node, title, branchCount) {
  return `
    <span class="node-topline">
      <span class="node-type">${escapeHtml(typeLabels[node.type])}</span>
      <span class="node-step">STAGE ${node.column}</span>
    </span>
    <strong>${escapeHtml(title)}</strong>
    <span class="node-detail">${escapeHtml(node.tech)}</span>
    ${node.type === "decision" ? `<span class="decision-branch">${branchCount} PATHS</span>` : ""}
  `;
}

function renderSubflowBoard(subflow) {
  const visibleNodes = getVisibleNodes(subflow.nodes);
  const maxColumn = Math.max(...visibleNodes.map((node) => node.column), 1);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdgeCount = subflow.edges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to) && isVisibleByPath(edge)).length;
  const visibleGroups = subflow.groups.filter((group) => group.members.some((nodeId) => visibleNodeIds.has(nodeId)));
  const groupBadges = visibleGroups
    .map((group) => `<span class="flow-group-badge mode-${escapeHtml(group.mode)}"><b>${escapeHtml(groupModeLabels[group.mode])}</b>${escapeHtml(group.label)}</span>`)
    .join("");
  const trackRows = subflow.tracks
    .map((track, index) => `
      <div class="subflow-track" style="grid-column: 1 / -1; grid-row: ${index + 1}">
        <span class="subflow-track-code">${escapeHtml(track.code)}</span>
        <strong>${escapeHtml(track.label)}</strong>
      </div>
    `)
    .join("");
  const childNodes = visibleNodes
    .map((node) => {
      const trackIndex = subflow.tracks.findIndex((track) => track.id === node.track);
      const branchCount = subflow.edges.filter((edge) => edge.from === node.id).length;
      return `
        <div class="subflow-node-slot" style="grid-column: ${node.column + 1}; grid-row: ${trackIndex + 1}">
          <button
            class="subflow-node ${node.id === state.selectedNodeId ? "is-selected" : ""}"
            type="button"
            data-select-node="${escapeHtml(node.id)}"
            data-node-id="${escapeHtml(node.id)}"
            data-child-node-id="${escapeHtml(node.id)}"
            data-type="${escapeHtml(node.type)}"
            data-path="${escapeHtml(node.path)}"
            data-group="${escapeHtml(subflow.groups.find((group) => group.members.includes(node.id))?.id ?? "")}"
          >
            ${renderNodeCardContent(node, node.title, branchCount)}
          </button>
        </div>
      `;
    })
    .join("");

  return `
    <section class="subflow-board kind-${escapeHtml(subflow.kind)}" data-subflow-id="${escapeHtml(subflow.id)}">
      <div class="subflow-board-meta">
        <span class="subflow-kind">${escapeHtml(subflowKindLabels[subflow.kind])}</span>
        <span>${visibleNodes.length} nodes</span>
        <span>${visibleEdgeCount} relations</span>
        <span>${subflow.tracks.length} tracks</span>
      </div>
      ${groupBadges ? `<div class="flow-group-strip">${groupBadges}</div>` : ""}
      <div class="subflow-grid" style="--sub-columns: ${maxColumn}; --sub-tracks: ${subflow.tracks.length}">
        <svg class="subflow-edge-layer" data-subflow-edge-layer="${escapeHtml(subflow.id)}" aria-hidden="true">
          <defs>
            <marker id="sub-arrow-${escapeHtml(subflow.id)}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L7,3.5 L0,7 Z" fill="context-stroke"></path>
            </marker>
          </defs>
        </svg>
        ${trackRows}
        ${childNodes}
      </div>
    </section>
  `;
}

function bindFlowInteractions() {
  bindNodeInteractions(laneContainer);
}

function bindNodeInteractions(root) {
  root.querySelectorAll("[data-select-node]").forEach((button) => {
    button.addEventListener("click", () => selectNode(button.dataset.selectNode));
  });
  root.querySelectorAll("[data-toggle-node]").forEach((button) => {
    button.addEventListener("click", () => openSubflowPanel(button.dataset.toggleNode, button));
  });
}

function openSubflowPanel(nodeId, trigger = null) {
  const node = getNodeById(nodeId);
  if (!node?.expands) return;
  const shouldResetPosition = state.activeSubflowId !== node.expands
    || state.activeSubflowParentId !== node.id
    || subflowOverlay.hidden;
  state.activeSubflowId = node.expands;
  state.activeSubflowParentId = node.id;
  lastSubflowTrigger = trigger;
  if (shouldResetPosition) subflowPanelPosition = null;
  state.selectedNodeId = node.id;
  document.querySelectorAll(".flow-node, .subflow-node").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.nodeId === node.id);
  });
  renderDetail(node);
  detailPanel.classList.add("is-open");
  renderActiveSubflow({ resetPosition: shouldResetPosition });
}

function closeSubflowPanel({ restoreFocus = true } = {}) {
  const trigger = lastSubflowTrigger;
  state.activeSubflowId = null;
  state.activeSubflowParentId = null;
  subflowOverlay.hidden = true;
  document.body.classList.remove("is-subflow-open");
  subflowDialogBody.innerHTML = "";
  lastSubflowTrigger = null;
  subflowDialog.style.removeProperty("left");
  subflowDialog.style.removeProperty("top");
  subflowDialog.style.removeProperty("right");
  if (restoreFocus) {
    const fallback = trigger?.isConnected
      ? trigger
      : document.querySelector(`[data-toggle-node="${CSS.escape(state.selectedNodeId ?? "")}"]`);
    fallback?.focus();
  }
}

function renderActiveSubflow({ resetPosition = false } = {}) {
  const subflow = getSubflow(state.activeSubflowId);
  const parent = getNodeById(state.activeSubflowParentId);
  const story = stories.find((item) => item.id === state.storyId);
  if (!subflow || !parent || !isVisibleByPath(parent) || !isNodeInStory(parent.id, story)) {
    if (!subflowOverlay.hidden) closeSubflowPanel({ restoreFocus: false });
    return;
  }

  const visibleNodes = getVisibleNodes(subflow.nodes);
  document.querySelector("#subflow-dialog-kicker").textContent = subflow.kind === "interaction" ? "画面内の動き / 詳細" : "システムの動き / 詳細";
  document.querySelector("#subflow-dialog-title").textContent = parent.title;
  document.querySelector("#subflow-dialog-summary").textContent = subflow.summary;
  document.querySelector("#subflow-dialog-kind").className = `kind-${subflow.kind}`;
  document.querySelector("#subflow-dialog-kind").textContent = subflowKindLabels[subflow.kind];
  document.querySelector("#subflow-dialog-count").textContent = `${visibleNodes.length} STEPS`;
  subflowDialogBody.innerHTML = renderSubflowBoard(subflow);
  bindNodeInteractions(subflowDialogBody);
  subflowOverlay.hidden = false;
  document.body.classList.add("is-subflow-open");
  requestAnimationFrame(() => {
    if (resetPosition || !subflowPanelPosition) {
      if (subflowPanelSize) applySubflowPanelSize(subflowPanelSize, { left: PANEL_GUTTER, top: PANEL_GUTTER });
      positionSubflowPanel();
    } else {
      applySubflowPanelSize(subflowPanelSize, subflowPanelPosition);
      applySubflowPanelPosition(subflowPanelPosition);
    }
    drawSubflowEdges(subflowDialogBody.querySelector(".subflow-board"));
  });
}

function rectsIntersect(first, second) {
  return Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
    * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)) > 0;
}

function getSubflowPanelSize() {
  const rect = subflowDialog.getBoundingClientRect();
  return {
    width: subflowDialog.offsetWidth || rect.width,
    height: subflowDialog.offsetHeight || rect.height,
  };
}

function clampSubflowPanelSize(size, position = subflowPanelPosition ?? { left: PANEL_GUTTER, top: PANEL_GUTTER }) {
  const maxWidth = Math.max(0, window.innerWidth - position.left - PANEL_GUTTER);
  const maxHeight = Math.max(0, window.innerHeight - position.top - PANEL_GUTTER);
  const minWidth = Math.min(PANEL_MIN_WIDTH, Math.max(0, window.innerWidth - PANEL_GUTTER * 2));
  const minHeight = Math.min(PANEL_MIN_HEIGHT, Math.max(0, window.innerHeight - PANEL_GUTTER * 2));
  return {
    width: Math.min(Math.max(minWidth, size.width), maxWidth || minWidth),
    height: Math.min(Math.max(minHeight, size.height), maxHeight || minHeight),
  };
}

function applySubflowPanelSize(size, position = subflowPanelPosition) {
  if (!size || subflowOverlay.hidden) return;
  const safePosition = position ?? { left: PANEL_GUTTER, top: PANEL_GUTTER };
  const clamped = clampSubflowPanelSize(size, safePosition);
  subflowPanelSize = clamped;
  subflowDialog.style.width = `${clamped.width}px`;
  subflowDialog.style.height = `${clamped.height}px`;
}

function scheduleSubflowEdgeRedraw() {
  if (subflowEdgeFrame) return;
  subflowEdgeFrame = requestAnimationFrame(() => {
    subflowEdgeFrame = null;
    drawEdges();
    drawSubflowEdges(subflowDialogBody.querySelector(".subflow-board"));
  });
}

function clampSubflowPanelPosition(position) {
  const { width, height } = getSubflowPanelSize();
  const maxLeft = Math.max(PANEL_GUTTER, window.innerWidth - width - PANEL_GUTTER);
  const maxTop = Math.max(PANEL_GUTTER, window.innerHeight - height - PANEL_GUTTER);
  return {
    left: Math.min(Math.max(PANEL_GUTTER, position.left), maxLeft),
    top: Math.min(Math.max(PANEL_GUTTER, position.top), maxTop),
  };
}

function applySubflowPanelPosition(position) {
  if (subflowOverlay.hidden) return;
  const clamped = clampSubflowPanelPosition(position);
  subflowPanelPosition = clamped;
  subflowDialog.style.left = `${clamped.left}px`;
  subflowDialog.style.top = `${clamped.top}px`;
  subflowDialog.style.right = "auto";
}

function positionSubflowPanel() {
  if (subflowOverlay.hidden) return;
  const { width: panelWidth, height: panelHeight } = getSubflowPanelSize();
  const source = lastSubflowTrigger?.closest?.("[data-top-node-id]")
    ?? document.querySelector(`[data-top-node-id="${CSS.escape(state.activeSubflowParentId ?? "")}"]`);
  const sourceRect = source?.getBoundingClientRect();
  const baseLeft = sourceRect ? sourceRect.left : window.innerWidth - panelWidth - PANEL_GUTTER;
  const baseTop = sourceRect ? sourceRect.top : PANEL_GUTTER;
  const balancedLeft = sourceRect
    ? Math.max(PANEL_GUTTER, Math.min(Math.round(window.innerWidth * 0.28), window.innerWidth - panelWidth - PANEL_GUTTER))
    : baseLeft;
  const candidates = sourceRect
    ? [
      { left: balancedLeft, top: sourceRect.bottom + PANEL_GAP },
      { left: sourceRect.left - panelWidth - PANEL_GAP, top: baseTop },
      { left: sourceRect.right + PANEL_GAP, top: baseTop },
      { left: baseLeft, top: sourceRect.top - panelHeight - PANEL_GAP },
    ]
    : [{ left: baseLeft, top: baseTop }];
  const safeCandidate = candidates.find((candidate) => {
    const position = clampSubflowPanelPosition(candidate);
    const candidateRect = new DOMRect(position.left, position.top, panelWidth, panelHeight);
    return !sourceRect || !rectsIntersect(candidateRect, sourceRect);
  }) ?? candidates[0];
  applySubflowPanelPosition(safeCandidate);
}

function moveSubflowPanelBy(deltaX, deltaY) {
  const rect = subflowDialog.getBoundingClientRect();
  const current = subflowPanelPosition ?? { left: rect.left, top: rect.top };
  applySubflowPanelPosition({ left: current.left + deltaX, top: current.top + deltaY });
}

function resizeSubflowPanelBy(deltaWidth, deltaHeight) {
  if (subflowOverlay.hidden) return;
  const rect = subflowDialog.getBoundingClientRect();
  const position = subflowPanelPosition ?? { left: rect.left, top: rect.top };
  applySubflowPanelSize({
    width: rect.width + deltaWidth,
    height: rect.height + deltaHeight,
  }, position);
  scheduleSubflowEdgeRedraw();
}

function updateScope() {
  const story = stories.find((item) => item.id === state.storyId);
  if (!story) return;
  const visibleNodes = getVisibleNodes();
  const visibleScopeIds = story.nodeIds.filter((id) => visibleNodes.some((node) => node.id === id));

  document.querySelectorAll(".flow-node, .subflow-node").forEach((button) => {
    const inScope = isNodeInStory(button.dataset.nodeId, story);
    button.classList.toggle("is-in-scope", inScope);
    button.classList.toggle("is-muted", !inScope);
  });

  const percentage = Math.round((visibleScopeIds.length / story.nodeIds.length) * 100);
  const visibleChildCount = [...document.querySelectorAll(".subflow-node.is-in-scope")].length;
  document.querySelector("#coverage-value").textContent = `${percentage}%`;
  document.querySelector("#coverage-bar").style.width = `${percentage}%`;
  document.querySelector("#coverage-caption").textContent = `${visibleScopeIds.length} / ${story.nodeIds.length} ノードを表示中${visibleChildCount ? ` ＋ 詳細 ${visibleChildCount}` : ""}`;
  updateBracket(story, visibleScopeIds);
}

function updateBracket(story, visibleScopeIds) {
  const elements = visibleScopeIds
    .map((id) => document.querySelector(`[data-top-node-id="${CSS.escape(id)}"]`))
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
  document.querySelectorAll(".flow-node, .subflow-node").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.nodeId === nodeId);
  });
  renderDetail(getNodeById(nodeId));
  detailPanel.classList.add("is-open");
  const selected = getNodeById(nodeId);
  if (!(selected?.isChild && selected.subflowId === state.activeSubflowId)) renderActiveSubflow();
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

  const parent = node.isChild ? getNodeById(node.parentId) : null;
  const subflow = getSubflow(node.isChild ? node.subflowId : node.expands);
  const lineage = parent && subflow
    ? `<div class="detail-lineage"><span>Experience</span><b>${escapeHtml(parent.title)}</b><i>/</i><span>${escapeHtml(subflowKindLabels[subflow.kind])}</span><b>${escapeHtml(subflow.title)}</b></div>`
    : "";

  detailContent.innerHTML = `
    <div class="detail-header">
      ${lineage}
      <div class="detail-type"><span></span>${escapeHtml(typeLabels[node.type])}</div>
      <h2 id="detail-title">${escapeHtml(node.title)}</h2>
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

    ${subflow && !node.isChild ? `
      <section class="detail-section detail-subflow">
        <h3>詳細フロー</h3>
        <div class="detail-subflow-card">
          <span>${subflow.kind === "interaction" ? "画面内の動き" : "システムの動き"} / ${escapeHtml(subflowKindLabels[subflow.kind])}</span>
          <strong>${escapeHtml(subflow.title)}</strong>
          <p>${escapeHtml(subflow.summary)}</p>
          <div><b>${subflow.nodes.length}</b> steps · <b>${subflow.edges.length}</b> relations</div>
        </div>
        <div class="detail-subflow-actions">
          <button type="button" id="detail-subflow-button">詳細パネルで見る</button>
        </div>
      </section>
    ` : ""}
  `;

  document.querySelector("#detail-subflow-button")?.addEventListener("click", (event) => openSubflowPanel(node.id, event.currentTarget));
}

function drawEdges() {
  const svgRect = edgeLayer.getBoundingClientRect();
  edgeLayer.setAttribute("viewBox", `0 0 ${svgRect.width} ${svgRect.height}`);
  edgeLayer.querySelectorAll(".edge-path, .edge-foreign").forEach((element) => element.remove());

  const story = stories.find((item) => item.id === state.storyId);
  if (!story) return;
  const visibleIds = new Set(getVisibleNodes().map((node) => node.id));
  const selectedNode = getNodeById(state.selectedNodeId);
  const selectedAnchorId = selectedNode?.isChild ? selectedNode.parentId : selectedNode?.id;

  edges.forEach((edge) => {
    if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) return;
    if (state.path !== "all" && edge.path !== "both" && edge.path !== state.path) return;

    const from = document.querySelector(`[data-top-node-id="${CSS.escape(edge.from)}"]`);
    const to = document.querySelector(`[data-top-node-id="${CSS.escape(edge.to)}"]`);
    if (!from || !to) return;

    const fromRect = from.getBoundingClientRect();
    const toRect = to.getBoundingClientRect();
    const inScope = story.nodeIds.includes(edge.from) && story.nodeIds.includes(edge.to);
    const selected = edge.from === selectedAnchorId || edge.to === selectedAnchorId;
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

  document.querySelectorAll(".subflow-board").forEach((board) => drawSubflowEdges(board));
}

function drawSubflowEdges(board) {
  if (!board) return;
  const subflow = getSubflow(board.dataset.subflowId);
  const layer = board.querySelector("[data-subflow-edge-layer]");
  if (!subflow || !layer) return;

  const layerRect = layer.getBoundingClientRect();
  layer.setAttribute("viewBox", `0 0 ${layerRect.width} ${layerRect.height}`);
  layer.querySelectorAll(".subflow-edge-path, .subflow-edge-foreign").forEach((element) => element.remove());
  const visibleIds = new Set(getVisibleNodes(subflow.nodes).map((node) => node.id));
  const story = stories.find((item) => item.id === state.storyId);
  const inScope = story?.nodeIds.includes(subflow.parentId);

  subflow.edges.forEach((edge) => {
    if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to) || !isVisibleByPath(edge)) return;
    const from = board.querySelector(`[data-child-node-id="${CSS.escape(edge.from)}"]`);
    const to = board.querySelector(`[data-child-node-id="${CSS.escape(edge.to)}"]`);
    if (!from || !to) return;

    const fromRect = from.getBoundingClientRect();
    const toRect = to.getBoundingClientRect();
    let x1 = fromRect.right - layerRect.left;
    let y1 = fromRect.top + fromRect.height / 2 - layerRect.top;
    let x2 = toRect.left - layerRect.left;
    let y2 = toRect.top + toRect.height / 2 - layerRect.top;
    let d;

    if (edge.loop || x2 <= x1) {
      x1 = fromRect.left + fromRect.width / 2 - layerRect.left;
      y1 = fromRect.bottom - layerRect.top;
      x2 = toRect.left + toRect.width / 2 - layerRect.left;
      y2 = toRect.top - layerRect.top;
      const loopY = Math.max(fromRect.bottom, toRect.bottom) - layerRect.top + 20;
      d = `M ${x1} ${y1} C ${x1} ${loopY}, ${x2} ${loopY}, ${x2} ${y2}`;
    } else {
      const bend = Math.max(22, Math.abs(x2 - x1) * 0.4);
      d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
    }

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", `subflow-edge-path edge-${edge.type} ${!inScope ? "is-muted" : ""} ${edge.path === "exception" ? "is-exception" : ""}`);
    path.setAttribute("marker-end", `url(#sub-arrow-${subflow.id})`);
    if (edge.from === state.selectedNodeId || edge.to === state.selectedNodeId) path.style.strokeWidth = "2.5";
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${edge.from} → ${edge.to}（${edgeTypeLabels[edge.type]}）`;
    path.appendChild(title);
    layer.appendChild(path);

    if (edge.label) {
      const foreign = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
      foreign.setAttribute("x", (x1 + x2) / 2 - 28);
      foreign.setAttribute("y", (y1 + y2) / 2 - 12);
      foreign.setAttribute("width", "56");
      foreign.setAttribute("height", "24");
      foreign.setAttribute("class", "subflow-edge-foreign");
      foreign.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="edge-label">${escapeHtml(edge.label)}</div>`;
      layer.appendChild(foreign);
    }
  });
}

function updateFlowSummary() {
  const visibleNodes = getVisibleNodes();
  const visibleChildren = subflows
    .filter((subflow) => subflow.parentId && visibleNodes.some((node) => node.id === subflow.parentId))
    .flatMap((subflow) => getVisibleNodes(subflow.nodes));
  document.querySelector("#flow-summary").innerHTML = `
    <span><b>${visibleNodes.length}</b> ノード</span>
    <span><b>UX</b> Experience</span>
    <span><b>${visibleChildren.length}</b> 詳細ノード</span>
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
    const selected = getNodeById(state.selectedNodeId);
    const selectedStillVisible = selected && isVisibleByPath(selected)
      && (!selected.isChild || isVisibleByPath(getParentNode(selected)));
    if (!selectedStillVisible) {
      const parent = selected?.isChild ? getParentNode(selected) : null;
      state.selectedNodeId = parent && isVisibleByPath(parent) ? parent.id : null;
      renderDetail(getNodeById(state.selectedNodeId));
    }
    renderActiveSubflow();
  });
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

subflowDialogClose.addEventListener("click", () => closeSubflowPanel());
document.addEventListener("keydown", (event) => {
  if (subflowOverlay.hidden) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeSubflowPanel();
  }
});

function finishSubflowDrag() {
  if (!subflowDragState) return;
  subflowDialogHeader.classList.remove("is-dragging");
  document.body.classList.remove("is-subflow-dragging");
  subflowDragState = null;
}

subflowDialogHeader.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest("button, a, input, select, textarea")) return;
  const rect = subflowDialog.getBoundingClientRect();
  subflowDragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: rect.left,
    startTop: rect.top,
  };
  subflowDialogHeader.classList.add("is-dragging");
  document.body.classList.add("is-subflow-dragging");
  subflowDialogHeader.setPointerCapture(event.pointerId);
  event.preventDefault();
});

subflowDialogHeader.addEventListener("pointermove", (event) => {
  if (!subflowDragState || event.pointerId !== subflowDragState.pointerId) return;
  applySubflowPanelPosition({
    left: subflowDragState.startLeft + event.clientX - subflowDragState.startX,
    top: subflowDragState.startTop + event.clientY - subflowDragState.startY,
  });
  event.preventDefault();
});

subflowDialogHeader.addEventListener("pointerup", finishSubflowDrag);
subflowDialogHeader.addEventListener("pointercancel", finishSubflowDrag);
subflowDialogHeader.addEventListener("lostpointercapture", finishSubflowDrag);
subflowDialogHeader.addEventListener("keydown", (event) => {
  if (subflowOverlay.hidden || !event.altKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const amount = event.shiftKey ? 80 : 24;
  const deltaX = event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0;
  const deltaY = event.key === "ArrowDown" ? amount : event.key === "ArrowUp" ? -amount : 0;
  moveSubflowPanelBy(deltaX, deltaY);
  event.preventDefault();
});

function finishSubflowResize() {
  if (!subflowResizeState) return;
  subflowResizeHandle.classList.remove("is-resizing");
  document.body.classList.remove("is-subflow-resizing");
  subflowResizeState = null;
  scheduleSubflowEdgeRedraw();
}

subflowResizeHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || subflowOverlay.hidden) return;
  const rect = subflowDialog.getBoundingClientRect();
  subflowResizeState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: rect.width,
    startHeight: rect.height,
    left: rect.left,
    top: rect.top,
  };
  subflowResizeHandle.classList.add("is-resizing");
  document.body.classList.add("is-subflow-resizing");
  subflowResizeHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
});

subflowResizeHandle.addEventListener("pointermove", (event) => {
  if (!subflowResizeState || event.pointerId !== subflowResizeState.pointerId) return;
  applySubflowPanelSize({
    width: subflowResizeState.startWidth + event.clientX - subflowResizeState.startX,
    height: subflowResizeState.startHeight + event.clientY - subflowResizeState.startY,
  }, { left: subflowResizeState.left, top: subflowResizeState.top });
  scheduleSubflowEdgeRedraw();
  event.preventDefault();
});

subflowResizeHandle.addEventListener("pointerup", finishSubflowResize);
subflowResizeHandle.addEventListener("pointercancel", finishSubflowResize);
subflowResizeHandle.addEventListener("lostpointercapture", finishSubflowResize);
subflowResizeHandle.addEventListener("keydown", (event) => {
  if (subflowOverlay.hidden || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const amount = event.shiftKey ? 80 : 24;
  const deltaWidth = event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0;
  const deltaHeight = event.key === "ArrowDown" ? amount : event.key === "ArrowUp" ? -amount : 0;
  resizeSubflowPanelBy(deltaWidth, deltaHeight);
  event.preventDefault();
});

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

window.addEventListener("resize", () => requestAnimationFrame(() => {
  if (!subflowOverlay.hidden) {
    const rect = subflowDialog.getBoundingClientRect();
    const position = subflowPanelPosition ?? { left: rect.left, top: rect.top };
    const safePosition = clampSubflowPanelPosition(position);
    applySubflowPanelPosition(safePosition);
    applySubflowPanelSize(subflowPanelSize ?? getSubflowPanelSize(), safePosition);
  }
  drawEdges();
}));
subflowDialogBody.addEventListener("scroll", scheduleSubflowEdgeRedraw, true);

async function bootstrap() {
  const specUrl = new URLSearchParams(window.location.search).get("spec");
  if (specUrl) {
    try {
      const response = await fetch(specUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await loadSpecText(await response.text(), specUrl);
      return;
    } catch (error) {
      showSpecError(new Error(`指定された仕様を取得できません: ${error.message}`), specUrl);
      return;
    }
  }
  await loadSpecText(bundledSpecYaml, "specs/login.yaml");
}

bootstrap();
