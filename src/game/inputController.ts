import { BALL_RADIUS } from '@/engine/constants';

export interface InputCallbacks {
  getState: () => {
    canInteract: boolean;
    canMoveCueBall: boolean;
    cueX: number;
    cueZ: number;
  };
  onAimAngleChange: (angle: number) => void;
  onPullPowerChange: (power: number, pulling: boolean) => void;
  onBallInHandDrag: (x: number, z: number) => void;
  onShoot: (angle: number, power: number) => void;
  screenToTable: (clientX: number, clientY: number) => { x: number; z: number } | null;
}

const MAX_PULL_DISTANCE_METERS = 0.32;
const CANCEL_POWER_THRESHOLD = 0.025;
const MIN_EFFECTIVE_LEVER_METERS = 0.65;
const WHEEL_STEP_RAD = 0.0008;
const PIN_BREAKAWAY_METERS = 0.032; // ~14px movement breaks sub-pixel pin cleanly back to 1:1 hover

export class PoolInputController {
  private element: HTMLElement;
  private cb: InputCallbacks;

  private mode: 'idle' | 'pulling' | 'dragging_ball' | 'fine_aim' = 'idle';
  private activePointerId: number | null = null;
  private currentAngle = 0;
  private lockedAngle = 0;
  private currentPower = 0;
  private pullAnchor = { x: 0, z: 0 };
  private lastHoverTablePos: { x: number; z: number } | null = null;
  private precisionPinPos: { x: number; z: number } | null = null;

  constructor(element: HTMLElement, callbacks: InputCallbacks) {
    this.element = element;
    this.cb = callbacks;

    this.element.addEventListener('pointerdown', this.handlePointerDown);
    this.element.addEventListener('pointermove', this.handlePointerMove);
    this.element.addEventListener('pointerup', this.handlePointerUp);
    this.element.addEventListener('pointercancel', this.handlePointerCancel);
    this.element.addEventListener('lostpointercapture', this.handleLostCapture);
    this.element.addEventListener('contextmenu', this.handleContextMenu);
    this.element.addEventListener('wheel', this.handleWheel, { passive: false });
    window.addEventListener('keydown', this.handleKeyDown);
  }

  setAngle(angle: number): void {
    this.currentAngle = angle;
    this.precisionPinPos = null;
  }

  getAngle(): number {
    return this.mode === 'pulling' ? this.lockedAngle : this.currentAngle;
  }

  getPower(): number {
    return this.mode === 'pulling' ? this.currentPower : 0;
  }

  isPulling(): boolean {
    return this.mode === 'pulling';
  }

  private cancelPull(preservePinAt?: { x: number; z: number } | null): void {
    if (this.mode === 'pulling') {
      this.mode = 'idle';
      this.currentPower = 0;
      this.cb.onPullPowerChange(0, false);
      if (preservePinAt) {
        this.precisionPinPos = preservePinAt;
      }
    } else if (this.mode === 'dragging_ball' || this.mode === 'fine_aim') {
      this.mode = 'idle';
      if (preservePinAt) {
        this.precisionPinPos = preservePinAt;
      }
    }
    this.lastHoverTablePos = preservePinAt ?? null;
    if (
      this.activePointerId !== null &&
      this.element.hasPointerCapture(this.activePointerId)
    ) {
      try {
        this.element.releasePointerCapture(this.activePointerId);
      } catch {
        // Ignore if already released
      }
    }
    this.activePointerId = null;
  }

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    if (this.mode === 'pulling') {
      this.cancelPull(this.lastHoverTablePos);
    }
  };

  private handleWheel = (e: WheelEvent): void => {
    const st = this.cb.getState();
    if (!st.canInteract || (this.mode !== 'idle' && this.mode !== 'fine_aim')) return;
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    if (dir === 0) return;
    const step = (e.shiftKey ? 0.3 : 1) * WHEEL_STEP_RAD * dir;
    const next = this.currentAngle + step;
    this.currentAngle = Math.atan2(Math.sin(next), Math.cos(next));
    if (this.lastHoverTablePos) {
      this.precisionPinPos = this.lastHoverTablePos;
    }
    this.cb.onAimAngleChange(this.currentAngle);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.mode === 'pulling') {
      this.cancelPull(this.lastHoverTablePos);
    }
  };

  private handlePointerDown = (e: PointerEvent): void => {
    const st = this.cb.getState();
    const hit = this.cb.screenToTable(e.clientX, e.clientY);

    if (e.button === 2) {
      e.preventDefault();
      if (this.mode === 'pulling') {
        this.cancelPull(hit ?? this.lastHoverTablePos);
        return;
      }
      if (st.canInteract && hit) {
        this.activePointerId = e.pointerId;
        this.mode = 'fine_aim';
        this.lastHoverTablePos = hit;
        this.precisionPinPos = hit;
        try {
          this.element.setPointerCapture(e.pointerId);
        } catch {
          // Ignore in synthetic environments
        }
      }
      return;
    }
    if (e.button !== 0 || !st.canInteract || !hit) return;

    this.activePointerId = e.pointerId;
    try {
      this.element.setPointerCapture(e.pointerId);
    } catch {
      // Some synthetic test environments do not support pointer capture
    }

    // Grab cue ball directly if in BALL_IN_HAND / BREAK_PLACEMENT and cursor is near cue ball
    const distToCue = Math.hypot(hit.x - st.cueX, hit.z - st.cueZ);
    if (st.canMoveCueBall && distToCue <= BALL_RADIUS * 2.4) {
      this.mode = 'dragging_ball';
      this.precisionPinPos = null;
      return;
    }

    // Lock current aim angle (respecting active sub-pixel pin) and pull back for shot power
    this.lockedAngle = this.currentAngle;
    this.pullAnchor = hit;
    this.mode = 'pulling';
    this.currentPower = 0;
    this.cb.onPullPowerChange(0, true);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const st = this.cb.getState();
    if (!st.canInteract) {
      if (this.mode !== 'idle') this.cancelPull();
      this.lastHoverTablePos = null;
      this.precisionPinPos = null;
      return;
    }

    const hit = this.cb.screenToTable(e.clientX, e.clientY);
    if (!hit) return;

    if (this.mode === 'dragging_ball' && e.pointerId === this.activePointerId) {
      this.cb.onBallInHandDrag(hit.x, hit.z);
      return;
    }

    if (this.mode === 'pulling' && e.pointerId === this.activePointerId) {
      // Project drag delta along opposite of cue aim direction (-cos, -sin)
      const backX = -Math.cos(this.lockedAngle);
      const backZ = -Math.sin(this.lockedAngle);
      const pullMeters =
        (hit.x - this.pullAnchor.x) * backX + (hit.z - this.pullAnchor.z) * backZ;
      const power = Math.max(0, Math.min(1, pullMeters / MAX_PULL_DISTANCE_METERS));
      this.currentPower = power;
      this.cb.onPullPowerChange(power, true);
      return;
    }

    const prevPos = this.lastHoverTablePos;
    this.lastHoverTablePos = hit;

    // Sub-pixel Vernier micrometer mode while holding Right Mouse Button or Shift
    if (this.mode === 'fine_aim' || e.shiftKey) {
      if (!prevPos) {
        this.precisionPinPos = hit;
        return;
      }
      const moveDx = hit.x - prevPos.x;
      const moveDz = hit.z - prevPos.z;
      const rx = hit.x - st.cueX;
      const rz = hit.z - st.cueZ;
      const rEff = Math.max(MIN_EFFECTIVE_LEVER_METERS, Math.hypot(rx, rz));
      const dTheta = ((rx * moveDz - rz * moveDx) / (rEff * rEff)) * 0.12;
      const next = this.currentAngle + Math.max(-0.08, Math.min(0.08, dTheta));
      this.currentAngle = Math.atan2(Math.sin(next), Math.cos(next));
      this.precisionPinPos = hit;
      this.cb.onAimAngleChange(this.currentAngle);
      return;
    }

    // After fine-tuning or cancelling a pull, hold angle steady until cursor moves purposefully away
    if (this.precisionPinPos) {
      const movedFromPin = Math.hypot(
        hit.x - this.precisionPinPos.x,
        hit.z - this.precisionPinPos.z
      );
      if (movedFromPin < PIN_BREAKAWAY_METERS) {
        return;
      }
      this.precisionPinPos = null;
    }

    // Direct 1:1 cursor tracking: cue always follows mouse; moving farther from cue ball yields finer steps naturally
    const distToCue = Math.hypot(hit.x - st.cueX, hit.z - st.cueZ);
    if (distToCue < BALL_RADIUS * 1.35) {
      return;
    }

    this.currentAngle = Math.atan2(hit.z - st.cueZ, hit.x - st.cueX);
    this.cb.onAimAngleChange(this.currentAngle);
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;

    const hit = this.cb.screenToTable(e.clientX, e.clientY);

    if (this.mode === 'fine_aim') {
      this.cancelPull(hit ?? this.lastHoverTablePos);
      return;
    }

    if (this.mode === 'dragging_ball') {
      this.cancelPull();
      return;
    }

    if (this.mode === 'pulling') {
      const finalAngle = this.lockedAngle;
      const finalPower = this.currentPower;
      this.cancelPull(hit ?? this.lastHoverTablePos);
      if (finalPower >= CANCEL_POWER_THRESHOLD) {
        this.cb.onShoot(finalAngle, finalPower);
      }
    }
  };

  private handlePointerCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.activePointerId) {
      this.cancelPull();
    }
  };

  private handleLostCapture = (e: PointerEvent): void => {
    if (e.pointerId === this.activePointerId && this.mode !== 'idle') {
      // Finish shot if released outside or cancel cleanly
      this.cancelPull();
    }
  };

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerUp);
    this.element.removeEventListener('pointercancel', this.handlePointerCancel);
    this.element.removeEventListener('lostpointercapture', this.handleLostCapture);
    this.element.removeEventListener('contextmenu', this.handleContextMenu);
    this.element.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('keydown', this.handleKeyDown);
  }
}
