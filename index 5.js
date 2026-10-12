// Без import: всё берём из глобального SillyTavern.getContext(),
// так расширение не зависит от путей и версии файлов Таверны.
const getContext = () => SillyTavern.getContext();
const extension_settings = new Proxy({}, {
    get: (_, k) => getContext().extensionSettings[k],
    set: (_, k, v) => { getContext().extensionSettings[k] = v; return true; },
});
const saveSettingsDebounced = () => getContext().saveSettingsDebounced();
const setExtensionPrompt = (...a) => getContext().setExtensionPrompt(...a);
const extension_prompt_types = { IN_CHAT: 1 };
const extension_prompt_roles = { SYSTEM: 0 };

const MODULE = 'ruler_ext';
const MAX = 30; // максимум шкалы, см
const defaults = { enabled: true, auto: true, start: 15, every: 1 };
let busy = false;
let counter = 0;

const TIERS = [
    [0, 'Позор рода'],
    [6, 'Посмешище'],
    [11, 'Середнячок'],
    [16, 'Достойный'],
    [22, 'Легенда'],
    [27, 'КОРОЛЬ'],
];

function settings() {
    extension_settings[MODULE] ??= {};
    for (const [k, v] of Object.entries(defaults)) extension_settings[MODULE][k] ??= v;
    return extension_settings[MODULE];
}

function getValue() {
    const ctx = getContext();
    if (!ctx.chatMetadata) return settings().start;
    ctx.chatMetadata[MODULE] ??= { value: settings().start };
    return ctx.chatMetadata[MODULE].value;
}

function setValue(v) {
    const ctx = getContext();
    if (!ctx.chatMetadata) return;
    v = Math.max(0, Math.min(MAX, v));
    ctx.chatMetadata[MODULE] = { value: v };
    ctx.saveMetadata();
    render();
    inject();
}

function tierName(v) {
    let name = TIERS[0][1];
    for (const [min, n] of TIERS) if (v >= min) name = n;
    return name;
}

function inject() {
    const s = settings();
    if (!s.enabled) {
        setExtensionPrompt(MODULE, '', extension_prompt_types.IN_CHAT, 0);
        return;
    }
    const v = getValue();
    const text =
        `[Шуточная шкала репутации «Линейка»: у {{char}} сейчас ${v} из ${MAX} — «${tierName(v)}». ` +
        `Это отражает его статус и самоощущение в глазах окружающих. ` +
        `Учитывай значение в поведении героя и реакциях других персонажей. Не упоминай шкалу напрямую.]`;
    setExtensionPrompt(MODULE, text, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
}

async function evaluate() {
    const s = settings();
    if (!s.enabled || !s.auto || busy) return;
    const ctx = getContext();
    const last = ctx.chat?.at(-1);
    if (!last || last.is_user || last.is_system) return;

    counter++;
    const every = Math.max(1, parseInt(s.every, 10) || 1);
    if (counter < every) return;
    counter = 0;

    busy = true;
    $('#ruler_fab').addClass('ruler-busy');
    try {
        const q =
            `[Пауза в сюжете. Оцени ${every > 1 ? `последние ${every} сообщений` : 'ТОЛЬКО последнее сообщение'}: как поступки и поведение персонажа ${ctx.name2} ` +
            `повлияли на его мужественность и статус? Достойный, смелый, сильный поступок: +1..+3. ` +
            `Нейтрально: 0. Трусость, провал, унижение, подлость, слабость: -1..-3. ` +
            `Ответь ТОЛЬКО одним целым числом от -3 до 3, без текста.]`;
        const res = await ctx.generateQuietPrompt({ quietPrompt: q, responseLength: 8 });
        const m = String(res).replace('−', '-').match(/-?\s?\d/);
        if (m) {
            const delta = Math.max(-3, Math.min(3, parseInt(m[0].replace(/\s/g, ''), 10)));
            if (delta !== 0) {
                setValue(getValue() + delta);
                flash(delta);
            }
        }
    } catch (e) {
        console.error('[ruler]', e);
    } finally {
        busy = false;
        $('#ruler_fab').removeClass('ruler-busy');
    }
}

function flash(delta) {
    const el = $(`<div class="ruler-flash ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta} см</div>`);
    $('#ruler_fab').append(el);
    setTimeout(() => el.remove(), 1800);
}

// Мультяшный силуэт-индикатор. Заливка идёт по ширине "ствола".
const SVG = `
<svg viewBox="0 0 220 70" class="ruler-svg">
  <defs>
    <clipPath id="ruler_clip">
      <circle cx="30" cy="22" r="18"/><circle cx="30" cy="48" r="18"/>
      <rect x="40" y="20" width="168" height="30" rx="15"/>
    </clipPath>
  </defs>
  <g clip-path="url(#ruler_clip)">
    <rect x="0" y="0" width="220" height="70" class="ruler-bg"/>
    <rect id="ruler_fill" x="0" y="0" width="0" height="70" class="ruler-fillbar"/>
  </g>
  <g class="ruler-outline">
    <circle cx="30" cy="22" r="18"/><circle cx="30" cy="48" r="18"/>
    <rect x="40" y="20" width="168" height="30" rx="15"/>
  </g>
</svg>`;

function render() {
    const v = getValue();
    $('#ruler_fill').attr('width', 40 + (v / MAX) * 168);
    $('#ruler_value').text(`${v} см`);
    $('#ruler_tier').text(tierName(v));
}

function buildUI() {
    if ($('#ruler_fab').length) return;
    const s = settings();
    $('body').append(`
      <div id="ruler_fab" title="Линейка">📏</div>
      <div id="ruler_panel" style="display:none">
        <div class="ruler-title">Линейка мужественности</div>
        ${SVG}
        <div class="ruler-row"><span id="ruler_value"></span><span id="ruler_tier"></span></div>
        <div class="ruler-row">
          <button class="menu_button" id="ruler_minus">−1</button>
          <button class="menu_button" id="ruler_plus">+1</button>
          <button class="menu_button" id="ruler_reset">Сброс</button>
        </div>
        <label class="checkbox_label"><input type="checkbox" id="ruler_enabled"> Включено</label>
        <label class="checkbox_label"><input type="checkbox" id="ruler_auto"> Авто-оценка моделью</label>
        <label class="checkbox_label">Оценивать раз в <input type="number" id="ruler_every" min="1" max="20" class="text_pole" style="width:60px"> сообщ.</label>
      </div>`);
    $('#ruler_enabled').prop('checked', s.enabled);
    $('#ruler_auto').prop('checked', s.auto);
    $('#ruler_every').val(s.every);

    $('#ruler_fab').on('click', () => $('#ruler_panel').toggle());
    $('#ruler_minus').on('click', () => setValue(getValue() - 1));
    $('#ruler_plus').on('click', () => setValue(getValue() + 1));
    $('#ruler_reset').on('click', () => setValue(settings().start));
    $('#ruler_enabled').on('change', function () { settings().enabled = this.checked; saveSettingsDebounced(); inject(); });
    $('#ruler_auto').on('change', function () { settings().auto = this.checked; saveSettingsDebounced(); });
    $('#ruler_every').on('change', function () {
        settings().every = Math.max(1, Math.min(20, parseInt(this.value, 10) || 1));
        counter = 0;
        saveSettingsDebounced();
    });
}

function addMenus() {
    // Пункт в меню волшебной палочки
    const menu = $('#extensionsMenu');
    if (menu.length && !$('#ruler_menu_item').length) {
        menu.append('<div id="ruler_menu_item" class="list-group-item flex-container flexGap5"><div class="fa-solid fa-ruler extensionsMenuExtensionButton"></div>Линейка</div>');
        $('#ruler_menu_item').on('click', () => $('#ruler_panel').toggle());
    }
    // Блок в настройках расширений
    const host = $('#extensions_settings2, #extensions_settings').first();
    if (host.length && !$('#ruler_settings_block').length) {
        host.append(
            '<div id="ruler_settings_block" class="inline-drawer">' +
            '<div class="inline-drawer-toggle inline-drawer-header"><b>Линейка мужественности</b>' +
            '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>' +
            '<div class="inline-drawer-content"><div class="menu_button" id="ruler_open_btn">Открыть линейку</div></div>' +
            '</div>');
        $('#ruler_open_btn').on('click', () => $('#ruler_panel').show());
    }
}

jQuery(() => {
    try {
        settings();
        buildUI();
        addMenus();
        render();
        inject();
        const ctx = getContext();
        const eventSource = ctx.eventSource;
        const event_types = ctx.eventTypes ?? ctx.event_types;
        eventSource.on(event_types.CHAT_CHANGED, () => { counter = 0; render(); inject(); });
        eventSource.on(event_types.MESSAGE_RECEIVED, () => setTimeout(evaluate, 300));
        if (window.toastr) toastr.success('Линейка загружена');
    } catch (e) {
        console.error('[ruler]', e);
        if (window.toastr) toastr.error(String(e && e.message || e), 'Линейка: ошибка');
    }
});
