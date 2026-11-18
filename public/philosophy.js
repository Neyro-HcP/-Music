(() => {
  "use strict";

  const thoughts = {
    identity: {
      number: "ЗАПИСЬ 01 / ЛИЧНОСТЬ И ОБСТОЯТЕЛЬСТВА",
      title: "Человек больше одного события",
      date: "07 ОКТЯБРЯ 2026",
      quote: "Если ты съел говно, это не значит, что ты говнистый человек. Иногда ты просто человек, который съел говно. Жизнь такова, главное — сохранить улыбку.",
      explanation: "Не позволяй отдельному событию становиться определением всей твоей личности.",
      analysis: "Неприятное событие, ошибка или нелепый поступок остаются частью биографии, но не обязаны становиться характеристикой человека целиком. Важно различать то, что с человеком произошло, и то, кем он является.",
      takeaway: "Ты можешь пережить нелепую ситуацию, но она не обязана определять тебя."
    },
    confidence: {
      number: "ЗАПИСЬ 02 / УВЕРЕННОСТЬ И МЕРА",
      title: "Уверенность и чувство меры",
      date: "18 НОЯБРЯ 2026",
      quote: "Если ты перданул на публике, не означает, что ты насрал им на жизнь. Иногда ты просто мимолётный влёт в их обстоятельства. Главное — быть уверенным, не забывая пердеть умеренно.",
      explanation: "Уверенность без меры превращается в бесцеремонность, а мера без уверенности — в постоянное самоограничение.",
      analysis: "Человек не должен стыдиться каждого случайного проявления себя или постоянно жить под контролем чужого мнения. Но уверенность не освобождает от уважения к окружающим: свобода самовыражения требует чувства меры.",
      takeaway: "Оставайся собой, не превращая уверенность в пренебрежение к другим."
    },
    dignity: {
      number: "ЗАПИСЬ 03 / ДОСТОИНСТВО И ОСКОРБЛЕНИЕ",
      title: "Оскорбление — ещё не победа",
      date: "18 НОЯБРЯ 2026",
      quote: "Попытка унизить человека не означает, что ты его победил. Иногда ты просто человек, который его оскорбил.",
      explanation: "Оскорбление не гарантирует, что ты задел его достоинство или добился превосходства. Иногда попытка унизить человека лишь демонстрирует твою собственную несдержанность и неспособность возвыситься иначе, кроме как за счёт обесценивания другого.",
      analysis: "Намерение, действие и результат — не одно и то же. Можно попытаться задеть человека, но это не делает обидчика сильнее и не доказывает, что он получил власть над чужим достоинством. Сам факт оскорбления говорит о выбранном способе поведения, а не о реальном превосходстве.",
      takeaway: "Умение оскорбить другого не является доказательством собственного превосходства."
    }
  };

  const dialog = document.getElementById("thoughtDialog");
  const fields = {
    kicker: document.getElementById("dialogKicker"),
    title: document.getElementById("dialogTitle"),
    date: document.getElementById("dialogDate"),
    quote: document.getElementById("dialogQuote"),
    explanation: document.getElementById("dialogExplanation"),
    analysis: document.getElementById("dialogAnalysis"),
    takeaway: document.getElementById("dialogTakeaway")
  };

  if (!dialog || Object.values(fields).some((field) => !field)) return;

  document.querySelectorAll("[data-thought]").forEach((button) => {
    button.addEventListener("click", () => {
      const thought = thoughts[button.dataset.thought];
      if (!thought) return;

      fields.kicker.textContent = thought.number;
      fields.title.textContent = thought.title;
      fields.date.textContent = thought.date;
      fields.quote.textContent = "«" + thought.quote + "»";
      fields.explanation.textContent = thought.explanation;
      fields.analysis.textContent = thought.analysis;
      fields.takeaway.textContent = thought.takeaway;

      if (typeof dialog.showModal === "function") dialog.showModal();
    });
  });

  const closeButton = dialog.querySelector("[data-close-dialog]");
  if (closeButton) closeButton.addEventListener("click", () => dialog.close());

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
})();