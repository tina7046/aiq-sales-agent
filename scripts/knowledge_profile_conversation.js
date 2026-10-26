// Fills the knowledge-profile plan with the name and users saved on
// Knowledge before this page loads. Runs before home_conversation.js
// so the header title and the pre-rendered thread already match.
// A direct visit with no draft keeps the authored placeholders.
(function () {
  var CONV_ID = "conv-knowledge-profile";
  var DRAFT_KEY = "sh:knowledge-profile-draft";
  var PLACEHOLDER_NAME = "New knowledge profile";

  function conversationId() {
    try {
      var id = new URLSearchParams(window.location.search).get("id");
      return id ? String(id).trim() : "";
    } catch (err) {
      return "";
    }
  }

  if (conversationId() !== CONV_ID) return;

  var root = document.querySelector("[data-sh-conv-root]");
  if (!root) return;

  var draft = null;
  try {
    draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
  } catch (err) {
    draft = null;
  }
  if (!draft || !draft.name) return;

  if (draft.approved) root.setAttribute("data-sh-kp-thinking", "true");

  var sessionName = "Learning about " + draft.name;
  var raw = root.getAttribute("data-sh-conversations");
  if (raw) {
    try {
      var map = JSON.parse(raw);
      if (map && map[CONV_ID]) {
        map[CONV_ID].title = sessionName;
        map[CONV_ID].recentLabel = sessionName;
        root.setAttribute("data-sh-conversations", JSON.stringify(map));
      }
    } catch (err) { /* leave the authored title */ }
  }

  var titleEl = document.querySelector("[data-sh-conv-title]");
  if (titleEl) {
    titleEl.textContent = sessionName;
    titleEl.setAttribute("title", sessionName);
  }

  var users = Array.isArray(draft.users)
    ? draft.users.filter(function (name) { return !!name; })
    : [];
  var templates = document.querySelectorAll(
    'template[data-sh-conv-for="' + CONV_ID + '"]'
  );

  Array.prototype.forEach.call(templates, function (tpl) {
    if (!tpl.content) return;
    replaceName(tpl.content, draft.name);
    fillUsers(tpl.content, users);
    if (draft.approved) {
      removeApprove(tpl.content);
      markThinking(tpl.content);
    }
  });

  function replaceName(scope, name) {
    var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
    var node = walker.nextNode();
    while (node) {
      if (node.nodeValue && node.nodeValue.indexOf(PLACEHOLDER_NAME) !== -1) {
        node.nodeValue = node.nodeValue.split(PLACEHOLDER_NAME).join(name);
      }
      node = walker.nextNode();
    }
  }

  function markThinking(scope) {
    var chip = scope.querySelector('[data-sh-conv-msg="kp-activity"]');
    if (!chip) return;
    var label = chip.querySelector(".seller-home__conv-msg-activity-label");
    var status = chip.querySelector(".seller-home__conv-msg-activity-status");
    if (label) label.textContent = "Learning";
    if (status) status.textContent = "Thinking";
    chip.setAttribute("aria-label", "Learning");
  }

  function removeApprove(scope) {
    var msg = scope.querySelector('[data-sh-conv-msg="kp-approve"]');
    if (!msg) return;
    var item = msg.closest("[data-sh-conv-item]") || msg.parentNode;
    if (item && item.parentNode) item.parentNode.removeChild(item);
  }

  function fillUsers(scope, names) {
    var table = scope.querySelector('[data-sh-conv-data-table="kp-users"]');
    if (!table) return;
    var tbody = table.querySelector("tbody");
    var sample = tbody && tbody.querySelector("tr");
    if (!tbody || !sample) return;

    if (!names.length) {
      var emptyBtn = sample.querySelector("button");
      if (emptyBtn) emptyBtn.textContent = "No users selected";
      return;
    }

    names.forEach(function (name, index) {
      var row = index === 0 ? sample : sample.cloneNode(true);
      var button = row.querySelector("button");
      if (button) button.textContent = name;
      row.setAttribute("data-sh-conv-data-row", "kp-user-" + index);
      if (index > 0) tbody.appendChild(row);
    });
  }
})();
