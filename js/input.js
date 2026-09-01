// Ohjaus: näppäimistö, peliohjain ja kosketusnäyttö samaan tilaan.
// Näppäimistön digitaalinen ohjaus pehmennetään rampilla, jotta pieniä korjauksia
// pystyy tekemään - muuten ratti olisi aina täysillä ääriasennossa.

const KEYMAP = {
  ArrowUp: 'throttle', KeyW: 'throttle',
  ArrowDown: 'brake', KeyS: 'brake',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'handbrake',
  ShiftLeft: 'clutch', ShiftRight: 'clutch',
  KeyQ: 'shiftDown', KeyE: 'shiftUp',
  KeyC: 'camera', KeyR: 'reset', KeyH: 'hud'
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.state = {
      steer: 0, throttle: 0, brake: 0, handbrake: false, clutch: 0,
      assist: 0.35, autoGear: true, steerBoost: 0
    };
    this.raw = { left: 0, right: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 0 };
    this.touch = { steer: 0, throttle: 0, brake: 0, handbrake: false, active: false };
    this.gamepadIndex = null;
    this.actions = {};
    this.sensitivity = 1;
    this.deadzone = 0.12;
    this.lastDevice = 'keyboard';
    this.bind();
  }

  on(name, fn) { this.actions[name] = fn; }
  fire(name) { if (this.actions[name]) this.actions[name](); }

  bind() {
    this._down = (e) => {
      if (e.repeat) return;
      const a = KEYMAP[e.code];
      if (!a) {
        if (e.code === 'Escape') this.fire('pause');
        return;
      }
      e.preventDefault();
      this.lastDevice = 'keyboard';
      this.keys.add(a);
      if (a === 'shiftUp') this.fire('shiftUp');
      if (a === 'shiftDown') this.fire('shiftDown');
      if (a === 'camera') this.fire('camera');
      if (a === 'reset') this.fire('reset');
      if (a === 'hud') this.fire('hud');
    };
    this._up = (e) => {
      const a = KEYMAP[e.code];
      if (a) { e.preventDefault(); this.keys.delete(a); }
    };
    this._blur = () => this.keys.clear();
    window.addEventListener('keydown', this._down, { passive: false });
    window.addEventListener('keyup', this._up, { passive: false });
    window.addEventListener('blur', this._blur);
    window.addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepadIndex = null; });
  }

  // Kosketusohjaus: vasen puoli on liukuva ratti, oikealla kaasu, jarru ja käsijarru.
  bindTouch(els) {
    const { wheel, gas, brake, hand } = els;
    let wheelId = null, wheelStart = 0;
    const setSteer = (v) => { this.touch.steer = Math.max(-1, Math.min(1, v)); };

    wheel.addEventListener('pointerdown', (e) => {
      wheelId = e.pointerId; wheelStart = e.clientX;
      wheel.setPointerCapture(e.pointerId);
      this.lastDevice = 'touch'; this.touch.active = true;
      e.preventDefault();
    });
    wheel.addEventListener('pointermove', (e) => {
      if (e.pointerId !== wheelId) return;
      // Noin 90 pikselin veto vastaa täyttä ohjausta - riittävän tarkka peukalolle.
      setSteer((e.clientX - wheelStart) / 90);
      e.preventDefault();
    });
    const endWheel = (e) => {
      if (e.pointerId !== wheelId) return;
      wheelId = null; setSteer(0);
    };
    wheel.addEventListener('pointerup', endWheel);
    wheel.addEventListener('pointercancel', endWheel);

    const hold = (el, key) => {
      el.addEventListener('pointerdown', (e) => {
        this.touch[key] = key === 'handbrake' ? true : 1;
        this.lastDevice = 'touch'; this.touch.active = true;
        el.classList.add('pressed');
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      const release = () => {
        this.touch[key] = key === 'handbrake' ? false : 0;
        el.classList.remove('pressed');
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', release);
    };
    hold(gas, 'throttle');
    hold(brake, 'brake');
    hold(hand, 'handbrake');
  }

  pollGamepad() {
    if (this.gamepadIndex === null || !navigator.getGamepads) return null;
    const gp = navigator.getGamepads()[this.gamepadIndex];
    if (!gp) return null;
    const dz = (v) => Math.abs(v) < this.deadzone ? 0 : (v - Math.sign(v) * this.deadzone) / (1 - this.deadzone);
    const btn = (i) => gp.buttons[i] ? gp.buttons[i].value : 0;
    const pressed = (i) => gp.buttons[i] && gp.buttons[i].pressed;

    const out = {
      steer: dz(gp.axes[0] || 0),
      throttle: Math.max(btn(7), pressed(0) ? 1 : 0),
      brake: btn(6),
      handbrake: pressed(2) || pressed(1),
      clutch: btn(3) ? 1 : 0
    };
    if (Math.abs(out.steer) > 0.02 || out.throttle > 0.02 || out.brake > 0.02) this.lastDevice = 'gamepad';

    if (pressed(5) && !this._gpUp) this.fire('shiftUp');
    if (pressed(4) && !this._gpDown) this.fire('shiftDown');
    if (pressed(9) && !this._gpStart) this.fire('pause');
    this._gpUp = pressed(5); this._gpDown = pressed(4); this._gpStart = pressed(9);
    return out;
  }

  update(dt) {
    const s = this.state;
    const gp = this.pollGamepad();

    let targetSteer = 0;
    let throttle = 0, brake = 0, handbrake = false, clutch = 0;
    let analog = false;

    if (gp && (Math.abs(gp.steer) > 0 || gp.throttle > 0 || gp.brake > 0 || gp.handbrake)) {
      targetSteer = gp.steer * this.sensitivity;
      throttle = gp.throttle; brake = gp.brake;
      handbrake = gp.handbrake; clutch = gp.clutch;
      analog = true;
    } else if (this.touch.active && (this.touch.steer !== 0 || this.touch.throttle || this.touch.brake || this.touch.handbrake)) {
      targetSteer = this.touch.steer * this.sensitivity;
      throttle = this.touch.throttle; brake = this.touch.brake;
      handbrake = this.touch.handbrake;
      analog = true;
    } else {
      const k = this.keys;
      targetSteer = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0);
      throttle = k.has('throttle') ? 1 : 0;
      brake = k.has('brake') ? 1 : 0;
      handbrake = k.has('handbrake');
      clutch = k.has('clutch') ? 1 : 0;
    }

    if (analog) {
      s.steer = targetSteer;
      s.steerBoost = 0;
    } else {
      // Ohjaus palautuu keskelle nopeammin kuin kääntyy - vastaohjaus on siten napakka.
      const rate = Math.abs(targetSteer) > 0 ? 3.4 * this.sensitivity : 6.2;
      const d = targetSteer - s.steer;
      s.steer += Math.max(-rate * dt, Math.min(rate * dt, d));
      if (Math.abs(targetSteer) < 0.01 && Math.abs(s.steer) < 0.02) s.steer = 0;
      // Nopea suunnanvaihto saa ratin liikkumaan reippaammin (kuljettajan nykäisy).
      s.steerBoost = (targetSteer !== 0 && Math.sign(targetSteer) !== Math.sign(s.steer)) ? 1 : 0;
    }

    s.throttle = throttle;
    s.brake = brake;
    s.handbrake = handbrake;
    s.clutch = clutch;
    return s;
  }

  dispose() {
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
    window.removeEventListener('blur', this._blur);
  }
}
