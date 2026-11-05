'use strict';
(function () {
  const normalize = (value) => String(value || '').toLocaleLowerCase('ru').trim();
  const search = document.getElementById('loreSearch');
  if (search) {
    const cards = Array.from(document.querySelectorAll('[data-lore-card]'));
    const buttons = Array.from(document.querySelectorAll('[data-lore-filter]'));
    const empty = document.getElementById('loreEmpty');
    let active = 'all';
    function update() {
      const query = normalize(search.value);
      let visible = 0;
      cards.forEach((card) => {
        const categoryMatch = active === 'all' || card.dataset.category === active;
        const textMatch = !query || normalize(card.dataset.search + ' ' + card.textContent).includes(query);
        const show = categoryMatch && textMatch;
        card.hidden = !show;
        if (show) visible += 1;
      });
      if (empty) empty.hidden = visible !== 0;
    }
    buttons.forEach((button) => button.addEventListener('click', () => {
      active = button.dataset.loreFilter || 'all';
      buttons.forEach((item) => {
        const selected = item === button;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
      update();
    }));
    search.addEventListener('input', update);
    update();
  }
  const timelineSearch = document.getElementById('timelineSearch');
  if (timelineSearch) {
    const items = Array.from(document.querySelectorAll('[data-timeline-item]'));
    const buttons = Array.from(document.querySelectorAll('[data-year-filter]'));
    const empty = document.getElementById('timelineEmpty');
    let activeYear = 'all';
    function updateTimeline() {
      const query = normalize(timelineSearch.value);
      let visible = 0;
      items.forEach((item) => {
        const yearMatch = activeYear === 'all' || item.dataset.year === activeYear;
        const textMatch = !query || normalize(item.dataset.search + ' ' + item.textContent).includes(query);
        const show = yearMatch && textMatch;
        item.hidden = !show;
        if (show) visible += 1;
      });
      if (empty) empty.hidden = visible !== 0;
    }
    buttons.forEach((button) => button.addEventListener('click', () => {
      activeYear = button.dataset.yearFilter || 'all';
      buttons.forEach((item) => {
        const selected = item === button;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
      updateTimeline();
    }));
    timelineSearch.addEventListener('input', updateTimeline);
    updateTimeline();
  }
})();