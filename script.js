const NODE_R  = 36;
const COL_GAP = 130;
const ROW_GAP = 100;
const PAD     = 50;

const COLOR_HEX = {
    alice: '#00d2ff',
    bob:   '#00ff88',
    carol: '#ff007a',
};

const state = {
    users: {
        alice: { balance: 0, vtxos: [], keys: ['alice_key_1', 'alice_change_1'] },
        bob:   { balance: 0, vtxos: [], keys: ['bob_key_1'] },
        carol: { balance: 0, vtxos: [], keys: ['carol_key_1'] }
    },
    vtxoGraph: [],  
    currentSender: null,
    roundCount: 0,
    nextBoardingRow: 0,
};


function clampCx(cx) { return Math.max(PAD + NODE_R, cx); }
function clampCy(cy) { return Math.max(PAD + NODE_R, cy); }

function updateUI() {
    for (const [name, data] of Object.entries(state.users)) {
        const fmt = data.balance.toLocaleString();
        const s = document.getElementById(`${name}-balance`);
        if (s) s.textContent = `${fmt} sats`;
    }
}

function addLog(message, level = 'info') {
    const list  = document.getElementById('log-list');
    const entry = document.createElement('div');
    entry.className = `log-entry ${level === 'leak' ? 'leak' : 'asp'}`;
    const time = new Date().toISOString();
    entry.innerHTML = `<span class="log-timestamp">time="${time}" level=${level === 'leak' ? 'warn' : level}</span> msg="${message}"`;
    list.prepend(entry);
}

function showLeak(text) {
    const t = document.getElementById('leak-alert-toast');
    t.textContent = text;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 5000);
}

function bumpRound() {
    state.roundCount++;
    const el = document.getElementById('asp-round-counter');
    if (el) el.textContent = `Round #${state.roundCount}`;
}

function openBoardModal() { document.getElementById('board-modal').style.display = 'flex'; }

function openSendModal(user) {
    if (state.users[user].balance <= 0) { alert('Insufficient balance'); return; }
    state.currentSender = user;
    document.getElementById('send-modal').style.display = 'flex';
    const sel = document.getElementById('modal-to');
    for (let o of sel.options) o.disabled = (o.value === user);
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function confirmBoard() {
    const amount = parseInt(document.getElementById('board-amount').value) || 10000000;
    const user   = document.getElementById('board-user').value;

    state.users[user].balance += amount;
    const id = randId();
    state.users[user].vtxos.push({ id, amount, owner: user });

    addLog(`Created Boarding VTXO [ID: ${id}, Amount: ${amount}]`);

    const cx = clampCx(PAD + NODE_R);
    const cy = clampCy(PAD + NODE_R + state.nextBoardingRow * ROW_GAP);
    state.nextBoardingRow++;

    placeNode(id, user, amount, cx, cy);
    updateUI();
    closeModal('board-modal');
}

function confirmSend() {
    const from   = state.currentSender;
    const to     = document.getElementById('modal-to').value;
    const amount = parseInt(document.getElementById('modal-amount').value) || 1000000;

    if (amount > state.users[from].balance) { alert('Amount exceeds balance'); return; }

    const inputVtxo    = state.users[from].vtxos.pop();
    state.users[from].balance -= inputVtxo.amount;

    const payId        = randId();
    const changeId     = randId();
    const changeAmount = inputVtxo.amount - amount;

    state.users[to].balance   += amount;
    state.users[from].balance += changeAmount;
    state.users[to].vtxos.push({ id: payId, amount, owner: to });
    if (changeAmount > 0) {
        state.users[from].vtxos.push({ id: changeId, amount: changeAmount, owner: from });
    }
    state.users[from].keys.push(`${from}_change_${Date.now()}`);

    showLeak('VTXO LINK');
    addLog(`ASP logged transfer ${from} → ${to}`, 'leak');
    addLog(`Spending VTXO [ID: ${inputVtxo.id}, Amount: ${inputVtxo.amount}]`);
    addLog(`Creating New VTXO [ID: ${payId}, Amount: ${amount}] (Payment to ${to})`);
    if (changeAmount > 0) {
        addLog(`Creating New VTXO [ID: ${changeId}, Amount: ${changeAmount}] (Change to ${from})`);
    }

    visualizeTransfer(inputVtxo.id, payId, changeId, to, from, amount, changeAmount);
    updateUI();
    closeModal('send-modal');
}

function checkBalance(user) {
    const keys = state.users[user].keys;
    addLog(`GetVtxos request from IP: 192.168.1.${Math.floor(Math.random()*255)}`);
    addLog(`User ${user.toUpperCase()} leaked all keys: [${keys.join(', ')}]`, 'leak');
    showLeak('FULL KEY EXPOSURE DETECTED');
    const card = document.getElementById(user);
    card.classList.add('card-danger');
    setTimeout(() => card.classList.remove('card-danger'), 2000);
}

function triggerRound(user) {
    if (!state.users[user].vtxos.length) { alert('No VTXOs to refresh!'); return; }

    const inputs = [...state.users[user].vtxos];
    state.users[user].vtxos = [];
    const total  = inputs.reduce((s, v) => s + v.amount, 0);
    const newId  = randId();
    state.users[user].vtxos.push({ id: newId, amount: total, owner: user });

    inputs.forEach(v => addLog(`Spending VTXO [ID: ${v.id}, Amount: ${v.amount}]`));
    addLog(`Creating New VTXO [ID: ${newId}, Amount: ${total}] (Refresh)`);
    showLeak('REFRESH LINKED BY ASP');
    addLog(`ASP linked VTXOs [${inputs.map(v=>v.id).join(', ')}] for ${user.toUpperCase()}`, 'leak');

    inputs.forEach(v => markSpent(v.id));

    const rightmost = inputs
        .map(v => state.vtxoGraph.find(n => n.id === v.id))
        .filter(Boolean)
        .sort((a, b) => b.cx - a.cx)[0];

    const cx = clampCx(rightmost ? rightmost.cx + COL_GAP : PAD + NODE_R);
    const cy = clampCy(rightmost ? rightmost.cy : PAD + NODE_R);
    placeNode(newId, user, total, cx, cy);

    inputs.forEach(v => {
        const src = state.vtxoGraph.find(n => n.id === v.id);
        if (src) drawLine(src.cx, src.cy, cx, cy, COLOR_HEX[user], true);
    });

    bumpRound();
    updateUI();
}

function triggerExit(user) {
    if (!state.users[user].vtxos.length) { alert('No VTXOs to offboard'); return; }

    const inputs = [...state.users[user].vtxos];
    const total  = inputs.reduce((s, v) => s + v.amount, 0);
    state.users[user].vtxos    = [];
    state.users[user].balance -= total;

    addLog(`Collaborative Exit (Offboard) for ${user.toUpperCase()}`);
    inputs.forEach(v => addLog(`Spending VTXO [ID: ${v.id}, Amount: ${v.amount}]`));
    const addr = `bc1q${Math.random().toString(16).substring(2,10)}`;
    addLog(`ASP Internal: Linking off-chain ${user.toUpperCase()} → on-chain ${addr}`, 'leak');
    showLeak('OFFBOARDING EXPOSES LINK TO ON-CHAIN TX ');

    inputs.forEach(v => markExited(v.id));
    updateUI();
}


function visualizeTransfer(oldId, payId, changeId, payOwner, changeOwner, payAmt, changeAmt) {
    const parent = state.vtxoGraph.find(n => n.id === oldId);
    if (!parent) return;

    markSpent(oldId);

    const cx = parent.cx + COL_GAP;

    if (changeAmt > 0) {
        const rawPayCy    = parent.cy - ROW_GAP / 2;
        const rawChangeCy = parent.cy + ROW_GAP / 2;
        const shift = Math.max(0, (PAD + NODE_R) - rawPayCy);
        const payCy    = clampCy(rawPayCy    + shift);
        const changeCy = clampCy(rawChangeCy + shift);

        placeNode(payId,    payOwner,    payAmt,    cx, payCy);
        placeNode(changeId, changeOwner, changeAmt, cx, changeCy);

        drawLine(parent.cx, parent.cy, cx, payCy,    COLOR_HEX[payOwner],    false);
        drawLine(parent.cx, parent.cy, cx, changeCy, COLOR_HEX[changeOwner], false);
        drawDot(parent.cx, parent.cy, COLOR_HEX[parent.owner]);
    } else {
        const cy = clampCy(parent.cy);
        placeNode(payId, payOwner, payAmt, cx, cy);
        drawLine(parent.cx, parent.cy, cx, cy, COLOR_HEX[payOwner], false);
    }
}

function placeNode(id, owner, amount, cx, cy) {
    const wrap = document.getElementById('vtxo-graph');
    const svg  = document.getElementById('vtxo-svg');
    const el   = document.createElement('div');
    const hex  = COLOR_HEX[owner] || '#ffcc00';

    el.id        = `node-${id}`;
    el.className = 'vtxo-node';
    el.style.left        = `${cx - NODE_R}px`;
    el.style.top         = `${cy - NODE_R}px`;
    el.style.borderColor = hex;
    el.style.background  = `radial-gradient(circle at 40% 35%, ${hex}22 0%, rgba(7,9,15,0.94) 65%)`;
    el.style.boxShadow   = `0 0 18px ${hex}40, inset 0 0 16px ${hex}0e`;

    el.innerHTML = `
        <div class="n-owner" style="color:${hex}">${owner.toUpperCase()}</div>
        <div class="n-amount">${fmtSats(amount)}</div>
        <div class="n-id">${id}</div>
    `;
    wrap.appendChild(el);

    const needW = cx + NODE_R + PAD;
    const needH = cy + NODE_R + PAD;
    const curW  = parseInt(wrap.style.minWidth  || 0);
    const curH  = parseInt(wrap.style.minHeight || 0);
    if (curW < needW) wrap.style.minWidth  = needW + 'px';
    if (curH < needH) wrap.style.minHeight = needH + 'px';

    const svgW = parseInt(svg.getAttribute('width')  || 0);
    const svgH = parseInt(svg.getAttribute('height') || 0);
    if (svgW < needW) svg.setAttribute('width',  needW);
    if (svgH < needH) svg.setAttribute('height', needH);

    state.vtxoGraph.push({ id, owner, cx, cy, spent: false });
}

function drawLine(x1, y1, x2, y2, hex, dashed) {
    const svg  = document.getElementById('vtxo-svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const cpx  = (x1 + x2) / 2;
    path.setAttribute('d', `M ${x1} ${y1} C ${cpx} ${y1}, ${cpx} ${y2}, ${x2} ${y2}`);
    path.setAttribute('class', `vtxo-line ${dashed ? 'dashed' : 'solid'}`);
    path.setAttribute('stroke', hex);
    svg.appendChild(path);
}

function drawDot(cx, cy, hex) {
    const svg = document.getElementById('vtxo-svg');
    const c   = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', 5);
    c.setAttribute('fill', hex); c.setAttribute('opacity', '0.9');
    svg.appendChild(c);
}

function markSpent(id) {
    const el = document.getElementById(`node-${id}`);
    if (el) el.classList.add('spent');
    const n = state.vtxoGraph.find(n => n.id === id);
    if (n) n.spent = true;
}

function markExited(id) {
    const el = document.getElementById(`node-${id}`);
    if (el) {
        el.classList.add('exited');
        const nid = el.querySelector('.n-id');
        if (nid) nid.insertAdjacentHTML('afterend', '<div class="n-exited">EXITED</div>');
    }
}

function randId() { return Math.random().toString(16).substring(2, 8); }

function fmtSats(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'k';
    return n.toString();
}

updateUI();