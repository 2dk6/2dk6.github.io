"use strict";

(() => {
  const { tasks, benchmarks, defaultTask, questions } = window.BENCHMARK_SITE;
  const tabs = document.getElementById("task-tabs");
  const sourceTabs = document.getElementById("source-tabs");
  const taskPanel = document.getElementById("task-panel");
  const panel = document.getElementById("example-panel");
  const examples = document.getElementById("example-pairs");
  const selectedSources = new Map();
  const labelEditor = window.BENCHMARK_LABEL_EDITOR;
  let activeTask;
  let language = labelEditor ? "zh" : "en";
  if (!labelEditor) {
    try { if (localStorage.getItem("organicbench-language") === "zh") language = "zh"; } catch {}
  }
  const translations = window.BENCHMARK_TRANSLATIONS;
  const toggle = document.getElementById("language-toggle");
  const ui = (key) => translations.ui[language][key];
  const revealedAnswers = new Set();
  const answerObserver = !labelEditor && "IntersectionObserver" in window
    ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const card = entry.target;
        revealedAnswers.add(card.closest(".example-pair").dataset.questionId);
        card.classList.add("answer-revealed");
        setTimeout(() => card.removeAttribute("inert"), 2200);
        answerObserver.unobserve(card);
      }
    }, { rootMargin: "0px 0px -18% 0px", threshold: 0 })
    : null;

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function rich(text, className = "") {
    const node = make("div", `question-text ${className}`);
    node.innerHTML = DOMPurify.sanitize(marked.parse(text || "", { breaks: true }));
    for (const image of node.querySelectorAll("img")) {
      const link = make("a", "figure-link");
      link.href = image.src;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = ui("openFigure");
      image.replaceWith(link);
      link.append(image);
    }
    renderMathInElement(node, {
      delimiters: [{left: "$$", right: "$$", display: true}, {left: "$", right: "$", display: false}],
      throwOnError: false
    });
    return node;
  }

  function questionCard(question) {
    const card = make("article", "question-card");
    const heading = make("header", "question-heading");
    heading.append(make("h2", "", ui("question")));
    card.append(heading);
    const content = make("div", "question-content");

    if (!question) {
      const placeholder = make("div", "empty-question");
      placeholder.append(make("p", "", ui("pendingQuestion")));
      content.append(placeholder);
    } else {
      if (question.prompt) content.append(rich(question.prompt, "question-prompt"));
      for (const figure of question.figures || []) {
        const image = make("img", "question-figure");
        image.src = figure.src;
        image.alt = figure.alt || ui("figure");
        image.loading = "lazy";
        const link = make("a", "figure-link");
        link.href = figure.src;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.title = ui("openFigure");
        link.append(image);
        content.append(link);
      }
      if (question.options?.length) {
        const options = make("ol", "question-options");
        options.type = "A";
        for (const option of question.options) {
          const item = make("li", "");
          item.append(rich(option));
          options.append(item);
        }
        content.append(options);
      }
      if (question.inputModality === "SMILES") {
        content.append(make("p", "input-modality", ui("smiles")));
      }
    }
    card.append(content);
    return card;
  }

  function answerResponse(text, choiceLetters) {
    const node = choiceLetters
      ? rich(`**${choiceLetters.join(", ")}**`, "answer-response")
      : rich(text, "answer-response");

    for (const link of node.querySelectorAll(".figure-link")) {
      link.classList.add("answer-structure-frame");
      link.querySelector("img").classList.add("answer-reveal-value");
    }

    for (const item of node.querySelectorAll("li")) {
      if (item.querySelector("p")) continue;
      const field = make("span", "answer-field");
      field.append(...item.childNodes);
      item.append(field);
    }
    for (const block of node.querySelectorAll("p, .answer-field")) {
      const hasImage = Boolean(block.querySelector("img"));
      const strong = block.firstElementChild;
      const match = strong?.tagName === "STRONG" && strong.textContent.match(/^([A-Z](?:,\s*[A-Z])*)(?:\.\s*(.*))?$/);
      if (match) {
        strong.classList.add("answer-choice-mark");
        strong.replaceChildren("(", make("span", "answer-reveal-value", match[1]), ")");
        if (match[2]) strong.after(document.createTextNode(`. ${match[2]}`));
        block.classList.add("answer-choice");
        for (const child of [...block.childNodes]) {
          if (child === strong || child.nodeType === Node.ELEMENT_NODE && child.querySelector("img")) continue;
          if (child.nodeType === Node.TEXT_NODE) {
            const [, punctuation, value] = child.textContent.match(/^([.\s]*)([\s\S]*)$/);
            if (value) child.replaceWith(document.createTextNode(punctuation), make("span", "answer-reveal-value", value));
          } else {
            const value = make("span", "answer-reveal-value");
            child.replaceWith(value);
            value.append(child);
          }
        }
        const hasOptionText = [...block.querySelectorAll(".answer-reveal-value")]
          .some(value => !strong.contains(value) && value.textContent.trim());
        if (hasOptionText) {
          const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
          let tail;
          while (walker.nextNode()) if (walker.currentNode.textContent.trim()) tail = walker.currentNode;
          if (tail && !strong.contains(tail)) tail.textContent = tail.textContent.replace(/\.(\s*)$/, "$1");
        }
      } else if (!hasImage && !(node.querySelector("img") && /^(Reference set|参考答案组)\s*\d+/.test(block.textContent))) {
        block.classList.add("answer-line");
        const value = make("span", "answer-reveal-value");
        value.append(...block.childNodes);
        block.append(value);
      }
    }
    return node;
  }

  function answerCard(question) {
    const card = make("article", "question-card answer-card");
    const heading = make("header", "question-heading");
    heading.append(make("h2", "", ui("answer")));
    const content = make("div", "question-content");
    if (question?.answer) {
      const letters = question.answer.trim().split(/,\s*/);
      const isChoice = letters.every(letter => /^[A-Z]$/.test(letter));
      if (isChoice) {
        if (question.options?.length) {
          for (const letter of letters) {
            content.append(answerResponse(`**${letter}**. ${question.options[letter.charCodeAt(0) - 65]}`));
          }
        } else content.append(answerResponse("", letters));
      } else content.append(answerResponse(question.answer));
    }
    else {
      const placeholder = make("div", "empty-question");
      placeholder.append(make("p", "", ui("pendingAnswer")));
      content.append(placeholder);
    }
    const editorRecord = labelEditor?.tagsForQuestion(question?.questionId);
    const strengths = editorRecord ? editorRecord.tagType === "strength" : question?.strengthTags?.length;
    const tags = editorRecord?.tags || (strengths ? question.strengthTags : question?.limitationTags);
    if (tags?.length) {
      const labels = make("ul", strengths ? "strength-tags" : "limitation-tags");
      labels.setAttribute("aria-label", strengths ? ui("strengths") : ui("limitations"));
      for (const text of tags) labels.append(make("li", strengths ? "strength-tag" : "limitation-tag", editorRecord ? text || "" : language === "zh" ? translations.tags[text] : text));
      labelEditor?.decorateLabels(labels, question.questionId);
      if (labels.children.length) content.append(labels);
    }
    card.append(heading, content);
    return card;
  }

  function renderExample(question) {
    const section = make("section", "example-pair");
    if (question?.questionId) section.dataset.questionId = question.questionId;
    const columns = make("div", "paired-questions");
    columns.append(questionCard(question), answerCard(question));
    section.append(columns);
    return section;
  }

  function questionRecord(id) {
    if (!id || !questions[id]) throw new Error(`Question record required: ${id}`);
    const question = language === "zh" ? { ...questions[id], ...translations.questions[id] } : questions[id];
    return { ...question, questionId: id };
  }

  function updateSelection(root, selectedId) {
    for (const tab of root.children) {
      const selected = tab.id === selectedId;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
  }

  function selectSource(id) {
    const source = activeTask.sources.find((item) => item.benchmarkId === id);
    if (!source) return;
    const tabId = `source-${activeTask.id}-${id}`;
    selectedSources.set(activeTask.id, id);
    updateSelection(sourceTabs, tabId);
    panel.setAttribute("aria-labelledby", tabId);
    panel.dataset.task = activeTask.id;
    panel.dataset.benchmark = id;
    const records = source.questionIds.map(questionRecord);
    answerObserver?.disconnect();
    examples.replaceChildren(...(records.length ? records : [null]).map(renderExample));
    if (answerObserver && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const card of examples.querySelectorAll(".answer-card")) {
        const questionId = card.closest(".example-pair").dataset.questionId;
        if (revealedAnswers.has(questionId)) continue;
        card.classList.add("answer-reveal-pending");
        card.setAttribute("inert", "");
        answerObserver.observe(card);
      }
    }
  }

  function selectTask(id) {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    activeTask = task;
    updateSelection(tabs, `task-${id}`);
    taskPanel.setAttribute("aria-labelledby", `task-${id}`);
    taskPanel.dataset.task = id;
    const sources = task.sources.map(source => {
      const benchmark = benchmarks.find(item => item.id === source.benchmarkId);
      if (!benchmark) throw new Error(`Benchmark required: ${source.benchmarkId}`);
      return benchmark;
    });
    createTabs(sources, sourceTabs, `source-${id}`, "example-panel", selectSource);
    selectSource(selectedSources.get(id) || sources[0].id);
  }

  function createTabs(items, root, prefix, controls, onSelect) {
    root.replaceChildren();
    items.forEach((item, index) => {
      const name = root === tabs && language === "zh" ? translations.tasks[item.id] : item.name;
      const button = make("button", root === tabs ? "benchmark-tab" : "topic-tab", name);
      if (root === sourceTabs && item.id === "organicbench") {
        button.classList.add("organicbench-tab");
        button.setAttribute("aria-label", "OrganicBench");
        const brand = make("span", "brand");
        const benzene = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        benzene.classList.add("benzene");
        benzene.setAttribute("viewBox", "0 0 100 100");
        benzene.setAttribute("fill", "none");
        benzene.setAttribute("aria-hidden", "true");
        benzene.innerHTML = '<path d="M50 4 90 27v46L50 96 10 73V27L50 4Z" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/><path d="m50 16 29 17M79 67 50 84M21 67V33" stroke="currentColor" stroke-width="4" stroke-linecap="square"/>';
        brand.setAttribute("aria-hidden", "true");
        brand.append(benzene, make("span", "", "rganicBench"));
        button.replaceChildren(brand);
      }
      button.id = `${prefix}-${item.id}`;
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", controls);
      button.addEventListener("click", () => onSelect(item.id));
      button.addEventListener("keydown", (event) => {
        let next;
        if (event.key === "ArrowRight") next = (index + 1) % items.length;
        if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = items.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        onSelect(items[next].id);
        root.children[next].focus();
      });
      root.append(button);
    });
  }

  function renderLanguage() {
    const taskId = activeTask?.id || defaultTask;
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    toggle?.setAttribute("aria-label", language === "zh" ? "语言" : "Language");
    for (const button of toggle?.querySelectorAll("button") || []) {
      button.setAttribute("aria-pressed", String(button.dataset.language === language));
    }
    tabs.setAttribute("aria-label", ui("selectTask"));
    sourceTabs.setAttribute("aria-label", ui("selectBenchmark"));
    createTabs(tasks, tabs, "task", "task-panel", selectTask);
    selectTask(taskId);
  }
  toggle?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-language]");
    if (!button || button.dataset.language === language) return;
    language = button.dataset.language;
    try { localStorage.setItem("organicbench-language", language); } catch {}
    renderLanguage();
  });
  if (labelEditor) labelEditor.ready.then(renderLanguage);
  else renderLanguage();
})();
