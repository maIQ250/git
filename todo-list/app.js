/**
 * Todo List —— 第 3 步：接入 localStorage 持久化
 *
 * 内存数组 todos 始终是界面唯一数据源：
 * 每次数据变更后用 saveTodos() 写入 localStorage，
 * 页面加载时用 loadTodos() 读回来。
 */
(function () {
  "use strict";

  /** localStorage 键名。带版本号，方便以后改数据结构时区分 */
  var STORAGE_KEY = "todo-list:v1";

  /** 任务列表数据：{ id, text, done, createdAt } */
  var todos = [];

  var form = document.getElementById("todo-form");
  var input = document.getElementById("todo-input");
  var list = document.getElementById("todo-list");
  var emptyState = document.getElementById("empty-state");
  var countLabel = document.getElementById("todo-count");

  var idSeed = 0;

  /** 生成任务 id */
  function createId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    idSeed += 1;
    return "todo-" + Date.now().toString(36) + "-" + idSeed;
  }

  /** 按 id 查找任务，找不到返回 null */
  function findTodo(id) {
    for (var i = 0; i < todos.length; i++) {
      if (todos[i].id === id) {
        return todos[i];
      }
    }
    return null;
  }

  /**
   * 把一条来路不明的数据整理成合法任务对象。
   * 无法修复时返回 null，由调用方丢弃该条。
   */
  function normalizeTodo(raw, usedIds) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    if (typeof raw.text !== "string") {
      return null;
    }

    var text = raw.text.trim();
    if (text === "") {
      return null;
    }

    // id 缺失或与已用 id 重复时重新生成，避免操作到错误的行
    var id = typeof raw.id === "string" && raw.id !== "" && !usedIds[id] ? raw.id : createId();
    usedIds[id] = true;

    return {
      id: id,
      text: text,
      done: raw.done === true,
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now()
    };
  }

  /**
   * 从 localStorage 读取任务。
   * 读不到、解析失败或结构不对时一律回退到空列表，
   * 保证坏数据不会让页面崩溃。
   */
  function loadTodos() {
    var raw;

    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      // localStorage 被浏览器策略禁用
      return [];
    }

    if (raw === null) {
      return [];
    }

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      // 不是合法 JSON
      return [];
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    var usedIds = {};
    var restored = [];

    parsed.forEach(function (item) {
      var todo = normalizeTodo(item, usedIds);
      if (todo !== null) {
        restored.push(todo);
      }
    });

    return restored;
  }

  /** 把当前任务列表写入 localStorage */
  function saveTodos() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    } catch (error) {
      // 无痕模式或存储配额用尽：落盘失败不影响内存中的功能
    }
  }

  /**
   * 添加任务。
   * 文本先 trim；空字符串或纯空格直接拒绝。
   * 成功返回新任务对象，被拒绝返回 null。
   */
  function addTodo(rawText) {
    var text = String(rawText).trim();
    if (text === "") {
      return null;
    }

    var todo = {
      id: createId(),
      text: text,
      done: false,
      createdAt: Date.now()
    };

    todos.push(todo);
    return todo;
  }

  /** 删除任务 */
  function deleteTodo(id) {
    for (var i = 0; i < todos.length; i++) {
      if (todos[i].id === id) {
        todos.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /** 切换完成状态（标记完成 / 取消完成） */
  function toggleTodo(id) {
    var todo = findTodo(id);
    if (todo === null) {
      return false;
    }

    todo.done = !todo.done;
    return true;
  }

  /**
   * 把任务数据同步到它对应的行上。
   * 只改这一行的类名、勾选状态和无障碍文本，不重建元素，
   * 所以键盘焦点不会被甩掉。
   */
  function syncTodoElement(item, todo) {
    item.classList.toggle("todo-item--done", todo.done);

    var checkbox = item.querySelector(".todo-item__checkbox");
    checkbox.checked = todo.done;
    checkbox.setAttribute(
      "aria-label",
      (todo.done ? "取消完成：" : "标记为已完成：") + todo.text
    );
  }

  /** 生成单个任务条目的 DOM 元素 */
  function createTodoElement(todo) {
    var item = document.createElement("li");
    item.className = "todo-item";
    item.dataset.id = todo.id;

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "todo-item__checkbox";
    checkbox.id = "check-" + todo.id;
    checkbox.addEventListener("change", function () {
      if (toggleTodo(todo.id)) {
        // 只刷新这一行，列表里的其它元素保持原样
        syncTodoElement(item, todo);
        commit();
      }
    });

    // 用 textContent 写入用户输入，避免 HTML 注入
    var label = document.createElement("label");
    label.className = "todo-item__text";
    label.htmlFor = checkbox.id;
    label.textContent = todo.text;

    var deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "todo-item__delete";
    deleteButton.textContent = "删除";
    deleteButton.setAttribute("aria-label", "删除任务：" + todo.text);
    deleteButton.addEventListener("click", function () {
      // 先记住邻居，删掉自己之后就找不到了
      var next = item.nextElementSibling;
      var previous = item.previousElementSibling;

      if (!deleteTodo(todo.id)) {
        return;
      }

      item.remove();
      commit();

      // 焦点移给相邻任务；列表空了就回到输入框
      var neighbour = next || previous;
      if (neighbour !== null) {
        neighbour.querySelector(".todo-item__checkbox").focus();
      } else {
        input.focus();
      }
    });

    item.appendChild(checkbox);
    item.appendChild(label);
    item.appendChild(deleteButton);

    syncTodoElement(item, todo);

    return item;
  }

  /** 刷新计数和空状态 */
  function updateSummary() {
    var remaining = todos.filter(function (todo) {
      return !todo.done;
    }).length;

    countLabel.textContent = remaining + " 项待完成";
    emptyState.hidden = todos.length > 0;
  }

  /** 按数据整体构建列表（只在页面加载时用一次） */
  function renderAll() {
    list.replaceChildren();

    todos.forEach(function (todo) {
      list.appendChild(createTodoElement(todo));
    });

    updateSummary();
  }

  /** 数据变更后的统一出口：先落盘，再刷新计数与空状态 */
  function commit() {
    saveTodos();
    updateSummary();
  }

  form.addEventListener("submit", function (event) {
    // 阻止表单默认提交导致页面刷新。
    // 输入框里按 Enter 触发的也是 submit 事件，走同一条路径。
    event.preventDefault();

    var created = addTodo(input.value);

    if (created !== null) {
      // 只追加这一条，不影响列表里已有的元素
      list.appendChild(createTodoElement(created));
      input.value = "";
    }

    commit();
    input.focus();
  });

  // 启动：先恢复上次的任务，再构建列表
  todos = loadTodos();
  renderAll();
})();
