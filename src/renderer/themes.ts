import type { ThemeId } from '../shared/types';

export interface ThemeDefinition {
  readonly id: ThemeId;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  readonly color: string;
  readonly number: string;
}

export const THEMES: readonly ThemeDefinition[] = [
  { id: 'munch', name: '贪吃阿噗', tagline: '软乎乎的小吃货', description: '一只胃口很好、脾气很软的桌面小怪兽。', color: '#568a53', number: '01' },
  { id: 'pixel', name: '像素工厂', tagline: '咔哒咔哒，开工了', description: '来自八位世界的勤劳机器人，方方正正地解决问题。', color: '#bc8b39', number: '02' },
  { id: 'blade', name: '小小坦克', tagline: '随时待命', description: '会盯着文件转动炮口的小坦克，随时待命。', color: '#719954', number: '03' },
  { id: 'void', name: '深空引力', tagline: '文件的宇宙旅行', description: '让多余的文件，消失在一颗安静的小小黑洞里。', color: '#9280be', number: '04' },
  { id: 'paper', name: '纸片风暴', tagline: '把旧文件变成彩纸', description: '一台爱庆祝的手作机器，把告别变成彩纸雨。', color: '#5b9a87', number: '05' },
  { id: 'pig', name: '猪波', tagline: '戴着眼镜的小小吃货', description: '戴圆框眼镜的可爱小猪，认真陪你整理，也认真等着开饭。', color: '#b77586', number: '06' },
];

function fileShape(): string {
  return '<path d="M-18-25H7L20-12V25H-18Z" fill="#fffdf4" stroke="#3c4945" stroke-width="2.4" stroke-linejoin="round"/><path d="M7-25V-12H20" fill="#e8e8d9" stroke="#3c4945" stroke-width="2.4" stroke-linejoin="round"/><path d="M-9-2H10M-9 6H10M-9 14H3" stroke="#a2aea2" stroke-width="2.5" stroke-linecap="round"/>';
}

function meal(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})"><g class="meal-file">${fileShape()}</g></g>`;
}

function fragments(colors: readonly string[]): string {
  return `<g class="scene-fragments">${Array.from({ length: 12 }, (_, index: number) => {
    const side = index % 2 === 0 ? -1 : 1;
    const x = side * (25 + (index % 6) * 16);
    const y = 23 + (index % 4) * 20;
    return `<rect class="scene-fragment" x="-3" y="-5" width="6" height="10" rx="1" fill="${colors[index % colors.length]}" style="--piece-x:${x}px;--piece-y:${y}px;--piece-turn:${side * (95 + index * 31)}deg;--piece-delay:${index * 47}ms"/>`;
  }).join('')}</g>`;
}

function statusMarks(): string {
  return '<g class="scene-success" transform="translate(303 98)"><circle r="17" fill="#edf3ec" stroke="#346538" stroke-width="2"/><path d="m-7 0 5 5 9-10" fill="none" stroke="#346538" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g><g class="scene-error" transform="translate(303 98)"><circle r="17" fill="#fdebec" stroke="#9f2f2d" stroke-width="2"/><path d="M0-7V2M0 8V9" fill="none" stroke="#9f2f2d" stroke-width="3" stroke-linecap="round"/></g>';
}

function munchScene(): string {
  return `<ellipse class="scene-shadow" cx="210" cy="289" rx="98" ry="13" fill="#344d2c" opacity=".13"/>
  <g class="ambient-specks" fill="#a0c883"><circle cx="104" cy="131" r="3"/><circle cx="319" cy="174" r="2.5"/><path d="m299 102 3-7 3 7 7 3-7 3-3 7-3-7-7-3Z"/><circle cx="109" cy="231" r="2"/></g>
  <g class="munch-character">
    <path class="munch-arm munch-arm-left" d="M134 191c-31-13-47 4-34 23 8 12 21 14 37 7" fill="#add984" stroke="#49734c" stroke-width="3"/>
    <path class="munch-arm munch-arm-right" d="M286 191c31-13 47 4 34 23-8 12-21 14-37 7" fill="#a6d27c" stroke="#49734c" stroke-width="3"/>
    <ellipse cx="166" cy="272" rx="28" ry="15" fill="#8ab76b" stroke="#49734c" stroke-width="3"/>
    <ellipse cx="254" cy="272" rx="28" ry="15" fill="#8ab76b" stroke="#49734c" stroke-width="3"/>
    <path d="M145 127c-8-16-6-28 1-30 9-3 20 9 24 19M249 117c6-17 17-24 24-19 6 5 6 17-3 29" fill="#add984" stroke="#49734c" stroke-width="3" stroke-linecap="round"/>
    <path d="M210 105c-55 0-91 36-94 97-3 51 28 76 94 76s97-25 94-76c-3-61-39-97-94-97Z" fill="#b3df8b" stroke="#49734c" stroke-width="3.5"/>
    <path d="M162 126c13-9 26-12 40-12" fill="none" stroke="#ecf8d9" stroke-width="8" stroke-linecap="round" opacity=".65"/>
    <ellipse cx="210" cy="231" rx="58" ry="35" fill="#e8f6d4" opacity=".85"/>
    <path d="m201 107 2-15 9 12 11-9 3 15" fill="#a8d57e" stroke="#49734c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <g class="pet-gaze"><g class="munch-eyes"><ellipse cx="177" cy="164" rx="9" ry="12" fill="#2f4430"/><ellipse cx="243" cy="164" rx="9" ry="12" fill="#2f4430"/><circle cx="180" cy="160" r="3" fill="#fffdf0"/><circle cx="246" cy="160" r="3" fill="#fffdf0"/></g>
    <g class="munch-happy-eyes" fill="none" stroke="#344a30" stroke-width="4" stroke-linecap="round"><path d="M168 164q9-12 18 0M234 164q9-12 18 0"/></g></g>
    <ellipse cx="153" cy="183" rx="13" ry="7" fill="#f0b89b" opacity=".65"/><ellipse cx="267" cy="183" rx="13" ry="7" fill="#f0b89b" opacity=".65"/>
    <path class="munch-mouth-smile" d="M191 190q19 22 38 0" fill="none" stroke="#344a30" stroke-width="4" stroke-linecap="round"/>
    <g class="munch-mouth-open"><ellipse cx="210" cy="196" rx="29" ry="27" fill="#35422b"/><ellipse cx="210" cy="211" rx="18" ry="9" fill="#e8a292"/><path d="M195 172h12v12q-6 8-12 0M217 172h10v10q-5 7-10 0" fill="#fff9dc"/></g>
    <path d="m204 245 6 3 6-3" fill="none" stroke="#99c17a" stroke-width="2" stroke-linecap="round"/>
  </g>
  ${meal(210, 75)}
  <g transform="translate(210 199)">${fragments(['#acd47e', '#f0ce76', '#f0b19a', '#f7ecc2'])}</g>
  ${statusMarks()}`;
}

function pigScene(): string {
  return `<ellipse class="scene-shadow" cx="210" cy="292" rx="85" ry="9" fill="#855866" opacity=".13"/>
  <g class="pig-character"><g class="pet-gaze">
    <svg class="pig-portrait" x="98" y="70" width="224" height="224" viewBox="0 0 627 627" overflow="hidden">
      <image class="pig-frame pig-frame-idle" href="./zhubo-sprites.png" width="1254" height="1254"/>
      <image class="pig-frame pig-frame-blink" href="./zhubo-sprites.png" x="-627" width="1254" height="1254"/>
      <image class="pig-frame pig-frame-eating" href="./zhubo-sprites.png" y="-627" width="1254" height="1254"/>
      <image class="pig-frame pig-frame-happy" href="./zhubo-sprites.png" x="-627" y="-627" width="1254" height="1254"/>
    </svg>
  </g></g>
  ${meal(210, 70)}
  <g transform="translate(210 190)">${fragments(['#efb1c3', '#f0ce76', '#ffe4e6', '#e9b889'])}</g>
  ${statusMarks()}`;
}

function pixelScene(): string {
  return `<ellipse class="scene-shadow" cx="210" cy="292" rx="98" ry="11" fill="#69533c" opacity=".14"/>
  <g class="pixel-character" shape-rendering="crispEdges" stroke="#4c493d" stroke-width="4" stroke-linejoin="miter">
    <path d="M146 265h40v21h-48v-11h8M234 265h40v10h8v11h-48" fill="#668f7c"/>
    <path class="pixel-arm-left" d="M131 172h-20v15H98v38h17v-25h16" fill="#e9b25a"/>
    <path class="pixel-arm-right" d="M289 172h20v15h13v38h-17v-25h-16" fill="#e9b25a"/>
    <path d="M140 119h140v12h13v126h-13v16H140v-16h-13V131h13Z" fill="#f6d17f"/>
    <path d="M141 121h136v11H141Z" fill="#fff0ba" stroke="none"/>
    <path d="M157 119v-14h106v14" fill="#92af83"/>
    <path d="M202 105V89h16v16" fill="#d5e8bc"/>
    <rect class="pixel-beacon" x="198" y="77" width="24" height="14" fill="#bce595"/>
    <path d="M147 145h126v65H147Z" fill="#354d43"/>
    <path d="M152 150h116v9H152Z" fill="#4b6654" stroke="none"/>
    <g class="pet-gaze"><g class="pixel-eyes" fill="#d5ecad" stroke="none"><path d="M167 168h20v20h-20ZM233 168h20v20h-20Z"/><path d="M194 190h32v5h-32Z"/></g></g>
    <path class="pixel-scan" d="M153 162h114" stroke="#b4d895" stroke-width="2" opacity=".4"/>
    <path d="M149 224h122v26H149Z" fill="#5f6959"/>
    <g class="pixel-teeth" fill="#f3dba5" stroke="none"><path d="M155 227h9v9h-9ZM174 227h9v9h-9ZM193 227h9v9h-9ZM212 227h9v9h-9ZM231 227h9v9h-9ZM250 227h9v9h-9Z"/><path d="M164 238h9v9h-9ZM183 238h9v9h-9ZM202 238h9v9h-9ZM221 238h9v9h-9ZM240 238h9v9h-9Z"/></g>
    <path d="M136 139h5v5h-5ZM279 139h5v5h-5ZM136 253h5v5h-5ZM279 253h5v5h-5Z" fill="#7d6647" stroke="none"/>
    <path d="M153 258h17v6h-17ZM176 258h17v6h-17Z" fill="#f3dca1" stroke="none"/>
  </g>
  <g class="pixel-sparks" fill="#e2b058" shape-rendering="crispEdges"><path d="M102 125h7v7h-7ZM310 139h6v6h-6ZM98 251h5v5h-5ZM304 98h9v9h-9Z"/></g>
  ${meal(210, 57)}
  <g transform="translate(210 234)">${fragments(['#e4b14e', '#c4dfa0', '#6f9f91', '#f5dea0'])}</g>
  ${statusMarks()}`;
}

function tankScene(): string {
  return `<g class="ambient-specks" fill="#b7d996"><path d="m106 155 3-7 3 7 7 3-7 3-3 7-3-7-7-3ZM292 113l2-5 2 5 5 2-5 2-2 5-2-5-5-2Z"/><circle cx="122" cy="112" r="2"/><circle cx="319" cy="248" r="2.5"/></g>
  <g class="tank-travel">
  <ellipse class="scene-shadow" cx="210" cy="285" rx="107" ry="12" fill="#52603e" opacity=".13"/>
  <g class="tank-character">
    <g class="tank-chassis">
      <rect x="105" y="229" width="210" height="48" rx="24" fill="#486244" stroke="#3d4c39" stroke-width="3.5"/>
      <rect x="114" y="237" width="192" height="31" rx="15.5" fill="#789565" stroke="#aecb8c" stroke-width="2"/>
      <g class="tank-wheels" fill="#afd38b" stroke="#3d4c39" stroke-width="2.5">${[132, 171, 210, 249, 288].map((x: number) => `<g class="tank-wheel"><circle cx="${x}" cy="253" r="12"/><path d="M${x - 5} 253h10M${x} 248v10" stroke="#5d704c" stroke-width="2"/></g>`).join('')}</g>
      <path d="m130 198 18-13h123l20 15 12 30H116Z" fill="#add38e" stroke="#4b7044" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M135 202h151" stroke="#e5f3cd" stroke-width="5" stroke-linecap="round"/>
      <path d="M148 193h16M257 193h15" stroke="#71864f" stroke-width="3" stroke-linecap="round"/>
      <path d="M161 208h99l6 21H155Z" fill="#b9dc95" opacity=".7"/>
      <g class="pet-gaze"><g class="tank-eyes" fill="#35472e"><ellipse cx="182" cy="216" rx="5" ry="6.5"/><ellipse cx="238" cy="216" rx="5" ry="6.5"/><circle cx="184" cy="214" r="1.8" fill="#fff8de"/><circle cx="240" cy="214" r="1.8" fill="#fff8de"/></g></g>
      <path d="M204 219q6 5 12 0" fill="none" stroke="#52643c" stroke-width="2.5" stroke-linecap="round"/>
      <ellipse cx="165" cy="220" rx="7" ry="3.5" fill="#edb98e" opacity=".7"/><ellipse cx="255" cy="220" rx="7" ry="3.5" fill="#edb98e" opacity=".7"/>
      <circle cx="134" cy="218" r="6" fill="#f8dc88" stroke="#657449" stroke-width="2"/><circle cx="286" cy="218" r="6" fill="#f8dc88" stroke="#657449" stroke-width="2"/>
      <path d="M173 184h74" stroke="#566c42" stroke-width="11" stroke-linecap="round"/>
    </g>
    <g class="tank-turret">
      <g class="tank-recoil">
        <path d="M236 175h72v18h-72" fill="#abd184" stroke="#4b7044" stroke-width="3" stroke-linejoin="round"/>
        <path d="M245 178h57" stroke="#d1dfb0" stroke-width="3" stroke-linecap="round"/>
        <rect x="301" y="170" width="17" height="28" rx="5" fill="#8bb56a" stroke="#4b7044" stroke-width="3"/>
        <path d="M313 177v14" stroke="#384a32" stroke-width="4" stroke-linecap="round"/>
        <path d="M169 181c0-27 16-40 41-40s40 15 40 40v13q-40 14-81 0Z" fill="#c7e6a9" stroke="#4b7044" stroke-width="3.5" stroke-linejoin="round"/>
        <path d="M180 167q8-15 27-16" fill="none" stroke="#e0e8c7" stroke-width="5" stroke-linecap="round"/>
        <rect x="194" y="135" width="32" height="10" rx="5" fill="#92ba6c" stroke="#4b7044" stroke-width="2.5"/>
        <path d="M199 138h17" stroke="#c1d29b" stroke-width="2" stroke-linecap="round"/>
        <path d="m211 164 3.7 7.5 8.3 1.2-6 5.8 1.4 8.2-7.4-3.9-7.4 3.9 1.4-8.2-6-5.8 8.3-1.2Z" fill="#f5e6b4"/>
        <path class="tank-antenna" d="m176 155-11-30" stroke="#52663f" stroke-width="2.5" stroke-linecap="round"/><circle cx="165" cy="125" r="3" fill="#c6e49c" stroke="#52663f" stroke-width="2"/>
      </g>
      <g class="tank-muzzle-flash"><path d="m317 184 13-8-1-12 11 11 15-4-8 13 8 13-15-4-11 11 1-12Z" fill="#efc96a" stroke="#d2a450" stroke-width="1.5" stroke-linejoin="round"/><path d="m319 184 16-5 9 5-9 5Z" fill="#fff7d4"/></g>
      <path class="tank-shot" d="M324 184h28" stroke="#f2ce77" stroke-width="5" stroke-linecap="round"/>
    </g>
  </g>
  <g class="tank-target">
    ${meal(354, 184)}
    <g transform="translate(354 184)"><circle class="tank-impact" r="22" fill="none" stroke="#d9ad5f" stroke-width="3"/>${fragments(['#95aa70', '#e2c278', '#f5e9c8', '#acb7a0'])}</g>
  </g>
  </g>
  ${statusMarks()}`;
}

function voidScene(): string {
  return `<ellipse class="scene-shadow" cx="210" cy="292" rx="88" ry="10" fill="#555570" opacity=".1"/>
  <g class="void-stars" fill="#b8a7d3"><circle cx="104" cy="92" r="2.5"/><circle cx="317" cy="127" r="2"/><circle cx="114" cy="250" r="2"/><circle cx="304" cy="250" r="3"/><circle cx="157" cy="58" r="1.5"/><path d="m309 75 2-6 2 6 6 2-6 2-2 6-2-6-6-2Z"/><path d="m78 188 2-5 2 5 5 2-5 2-2 5-2-5-5-2Z"/></g>
  <g class="pet-gaze"><g class="void-system">
    <g transform="rotate(-24 210 174)"><ellipse cx="210" cy="174" rx="133" ry="49" fill="none" stroke="#a493c9" stroke-width="1" opacity=".45"/><ellipse cx="210" cy="174" rx="117" ry="37" fill="none" stroke="#b3a1de" stroke-width="11"/><ellipse cx="210" cy="174" rx="126" ry="43" fill="none" stroke="#d0bdeb" stroke-width="1.5" opacity=".7"/></g>
    <circle class="void-core" cx="210" cy="174" r="66" fill="#39354f" stroke="#baa4e3" stroke-width="3"/>
    <circle cx="210" cy="174" r="71" fill="none" stroke="#d1bdf0" stroke-width="1" opacity=".55"/>
    <path d="M96 222c28 13 88 1 139-21s88-51 85-69" fill="none" stroke="#b3a1de" stroke-width="10" stroke-linecap="round"/>
    <path d="M96 225c37 11 103-8 145-28s69-40 78-56" fill="none" stroke="#fff0c6" stroke-width="2" opacity=".8"/>
    <g class="void-orbits" fill="#f3dfa9"><circle cx="102" cy="209" r="4"/><circle cx="303" cy="128" r="3"/><circle cx="258" cy="226" r="2"/></g>
    <path class="void-core-glint" d="M177 135a49 49 0 0 1 53-10" fill="none" stroke="#787296" stroke-width="2" stroke-linecap="round"/>
  </g></g>
  <circle class="void-ripple" cx="210" cy="174" r="77" fill="none" stroke="#b8a3df" stroke-width="2"/>
  ${meal(290, 77)}
  <g transform="translate(210 174)">${fragments(['#b8a3df', '#f2dfaa', '#9bc9d2', '#dcc5df'])}</g>
  ${statusMarks()}`;
}

function paperScene(): string {
  return `<ellipse class="scene-shadow" cx="210" cy="292" rx="101" ry="11" fill="#596965" opacity=".13"/>
  <g class="paper-machine">
    <path d="m126 151 24-21h126l22 21" fill="#fff6db" stroke="#455c5a" stroke-width="3" stroke-linejoin="round"/>
    <path d="m298 151 14 15v96l-14 14-8-27Z" fill="#dfc99d" stroke="#455c5a" stroke-width="3" stroke-linejoin="round"/>
    <rect x="122" y="150" width="176" height="117" rx="12" fill="#fff0ce" stroke="#455c5a" stroke-width="3"/>
    <path d="M130 169h160v59H130Z" fill="#a4d7c5"/>
    <path d="M130 169h160v8H130Z" fill="#d5efe1" opacity=".55"/>
    <rect x="148" y="143" width="124" height="18" rx="7" fill="#405b56" stroke="#455c5a" stroke-width="2"/>
    <g class="paper-roller"><circle cx="143" cy="153" r="12" fill="#e9a274" stroke="#455c5a" stroke-width="2.5"/><path d="M135 153h16M143 145v16" stroke="#ffe4bd" stroke-width="2"/></g>
    <g class="paper-roller"><circle cx="277" cy="153" r="12" fill="#e9a274" stroke="#455c5a" stroke-width="2.5"/><path d="M269 153h16M277 145v16" stroke="#ffe4bd" stroke-width="2"/></g>
    <rect x="163" y="184" width="94" height="28" rx="4" fill="#fff6d8" stroke="#638582" stroke-width="2"/>
    <path class="paper-display-lines" d="M177 192h29M177 200h44" stroke="#b7c397" stroke-width="2" stroke-linecap="round"/>
    <g class="pet-gaze"><g class="paper-eyes" fill="#48665e"><ellipse cx="185" cy="197" rx="3.5" ry="5"/><ellipse cx="215" cy="197" rx="3.5" ry="5"/><path d="M196 201q4 3 8 0" fill="none" stroke="#48665e" stroke-width="2" stroke-linecap="round"/></g></g>
    <circle class="paper-light" cx="242" cy="198" r="5" fill="#e9bc69"/>
    <rect x="144" y="235" width="132" height="17" rx="3" fill="#506c62"/>
    <path d="M137 268v12h27v-12M256 268v12h27v-12" fill="#79ad97" stroke="#455c5a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M136 242h1M284 242h1M136 160h1M284 160h1" stroke="#7c816d" stroke-width="3" stroke-linecap="round"/>
    <g class="paper-crank"><path d="M300 190h21v-20" fill="none" stroke="#536f68" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><rect x="313" y="155" width="16" height="21" rx="6" fill="#e7a172" stroke="#455c5a" stroke-width="2.5"/></g>
  </g>
  <g class="paper-output">${Array.from({ length: 9 }, (_, index: number) => `<path class="paper-strip" d="M${154 + index * 13} 244v${24 + (index % 3) * 9}q3 6 7 2" fill="none" stroke="${['#edae87', '#f1d17e', '#97d3bd', '#b9d399'][index % 4]}" stroke-width="7" style="--strip-delay:${index * 70}ms"/>`).join('')}</g>
  <path class="paper-decoration" d="m100 116 7-9 7 9-7 9ZM309 112l10 6-4 12-10-6Z" fill="#efce8c" opacity=".7"/>
  ${meal(210, 82)}
  <g transform="translate(210 249)">${fragments(['#e9a47b', '#f0cf76', '#8bceb8', '#c1d99e'])}</g>
  ${statusMarks()}`;
}

const SCENES: Readonly<Record<ThemeId, () => string>> = {
  munch: munchScene,
  pixel: pixelScene,
  blade: tankScene,
  void: voidScene,
  paper: paperScene,
  pig: pigScene,
};

export function sceneMarkup(id: ThemeId): string {
  return `<div class="creature-scene" data-theme="${id}" aria-hidden="true"><svg viewBox="0 0 420 340" xmlns="http://www.w3.org/2000/svg" focusable="false">${SCENES[id]()}</svg></div>`;
}
