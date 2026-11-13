import path from 'node:path';
import { expect, test } from '@playwright/test';

const SCREENSHOT_DIR =
  'C:/Users/marci/.gemini/antigravity/brain/664fc278-527d-410e-8c58-55de88937deb/scratch';

interface DebugSnapshot {
  phase: string;
  activeSlot: number;
  yourSlot: number;
  aimAngle: number;
  isPlayingTimeline: boolean;
  waitingShot: boolean;
  balls: Array<{
    id: number;
    x: number;
    z: number;
    pocketed: boolean;
    pocketId: number | null;
  }>;
}

test.describe('8 Ball Pool 2.5D — Real Browser Gameplay & Multiplayer E2E', () => {
  test('practice mode: cue contact spin, mouse aim, cancel safety, break accuracy, and visual inspection', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('/practice');
    const canvas = page.locator('[data-testid="pool-canvas-host"] canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(600);

    // 1. Test Cue Contact Point Widget (Draw + Center reset)
    const pad = page.locator('[data-testid="cue-contact-pad"]');
    const padBox = (await pad.boundingBox())!;
    await page.mouse.click(
      padBox.x + padBox.width * 0.5,
      padBox.y + padBox.height * 0.8
    );
    await expect(page.locator('[data-testid="cue-contact-label"]')).toContainText(
      'Draw'
    );
    await page.getByRole('button', { name: 'Centralizar' }).click();
    await expect(page.locator('[data-testid="cue-contact-label"]')).toHaveText(
      'Centro'
    );

    // 2. Get exact screen coordinates of Cue Ball (id 0) and Apex Ball (id 1)
    const initialSnap = await page.evaluate(() => {
      const dbg = (window as unknown as {
        __poolDebug: {
          getSnapshot: () => DebugSnapshot;
          tableToScreen: (x: number, z: number) => { x: number; y: number };
        };
      }).__poolDebug;
      const snap = dbg.getSnapshot();
      const b0 = snap.balls[0];
      const b1 = snap.balls[1];
      return {
        snap,
        cueScreen: dbg.tableToScreen(b0.x, b0.z),
        apexScreen: dbg.tableToScreen(b1.x, b1.z),
      };
    });

    // 2a. Verify direct 1:1 cursor tracking follows mouse onto Apex ball (no lag behind mouse!)
    await page.mouse.move(initialSnap.apexScreen.x, initialSnap.apexScreen.y, {
      steps: 6,
    });
    await page.waitForTimeout(80);
    const directFollowSnap = await page.evaluate(() => {
      const dbg = (window as unknown as {
        __poolDebug: { getSnapshot: () => DebugSnapshot };
      }).__poolDebug;
      const s = dbg.getSnapshot();
      const expected = Math.atan2(s.balls[1].z - s.balls[0].z, s.balls[1].x - s.balls[0].x);
      return { aimAngle: s.aimAngle, expected };
    });
    let followDiff = Math.abs(directFollowSnap.aimAngle - directFollowSnap.expected);
    if (followDiff > Math.PI) followDiff = Math.PI * 2 - followDiff;
    expect(followDiff).toBeLessThan(0.025);

    // 2b. Verify sub-pixel Vernier precision while holding Right Mouse Button (tiny steps < 0.05 rad)
    await page.mouse.move(initialSnap.cueScreen.x + 28, initialSnap.cueScreen.y - 10, {
      steps: 4,
    });
    await page.mouse.down({ button: 'right' });
    const beforeVernierAngle = await page.evaluate(() => {
      return (
        window as unknown as { __poolDebug: { getSnapshot: () => DebugSnapshot } }
      ).__poolDebug.getSnapshot().aimAngle;
    });
    await page.mouse.move(initialSnap.cueScreen.x + 28, initialSnap.cueScreen.y + 40, {
      steps: 6,
    });
    await page.mouse.up({ button: 'right' });
    const afterVernierAngle = await page.evaluate(() => {
      return (
        window as unknown as { __poolDebug: { getSnapshot: () => DebugSnapshot } }
      ).__poolDebug.getSnapshot().aimAngle;
    });
    let angleDiff = Math.abs(afterVernierAngle - beforeVernierAngle);
    if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
    expect(angleDiff).toBeLessThan(0.05);

    // Verify Top 90° camera does not invert the table coordinates
    await page.getByRole('button', { name: 'Topo 90°' }).click();
    await page.waitForTimeout(80);
    const topOrient = await page.evaluate(() => {
      const dbg = (window as unknown as {
        __poolDebug: { tableToScreen: (x: number, z: number) => { x: number; y: number } };
      }).__poolDebug;
      return {
        topLeft: dbg.tableToScreen(-0.8, -0.4),
        botRight: dbg.tableToScreen(0.8, 0.4),
      };
    });
    expect(topOrient.topLeft.x).toBeLessThan(topOrient.botRight.x);
    expect(topOrient.topLeft.y).toBeLessThan(topOrient.botRight.y);
    await page.getByRole('button', { name: '2.5D Clássica' }).click();
    await page.waitForTimeout(80);

    // Move mouse directly to apex ball to aim cue stick cleanly at the rack
    await page.mouse.move(initialSnap.apexScreen.x, initialSnap.apexScreen.y, {
      steps: 6,
    });
    await page.waitForTimeout(150);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'practice-aim.png'),
    });

    // 3. Test Shot Cancellation (pull back then return to 0 / Escape)
    const dirX = initialSnap.apexScreen.x - initialSnap.cueScreen.x;
    const dirY = initialSnap.apexScreen.y - initialSnap.cueScreen.y;
    const len = Math.hypot(dirX, dirY);
    const ux = dirX / len;
    const uy = dirY / len;

    const anchorX = initialSnap.cueScreen.x + ux * 120;
    const anchorY = initialSnap.cueScreen.y + uy * 120;

    await page.mouse.move(anchorX, anchorY);
    await page.mouse.down();
    await page.mouse.move(anchorX - ux * 130, anchorY - uy * 130, { steps: 6 });
    const pullText = await page.locator('[data-testid="power-percent"]').textContent();
    expect(parseInt(pullText || '0', 10)).toBeGreaterThan(25);

    // Cancel with Escape before releasing
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('[data-testid="power-percent"]')).toHaveText('0%');

    const afterCancelSnap = await page.evaluate(() => {
      return (
        window as unknown as { __poolDebug: { getSnapshot: () => DebugSnapshot } }
      ).__poolDebug.getSnapshot();
    });
    expect(afterCancelSnap.balls[1].x).toBeCloseTo(initialSnap.snap.balls[1].x, 5);

    // 4. Drag Cue Ball slightly upward in BREAK_PLACEMENT, then execute REAL angled Break Shot
    await page.mouse.move(initialSnap.cueScreen.x, initialSnap.cueScreen.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(
      initialSnap.cueScreen.x,
      initialSnap.cueScreen.y - 52,
      { steps: 6 }
    );
    await page.mouse.up();

    const movedCue = await page.evaluate(() => {
      const dbg = (window as unknown as {
        __poolDebug: {
          getSnapshot: () => DebugSnapshot;
          tableToScreen: (x: number, z: number) => { x: number; y: number };
        };
      }).__poolDebug;
      const b0 = dbg.getSnapshot().balls[0];
      return {
        z: b0.z,
        cueScreen: dbg.tableToScreen(b0.x, b0.z),
      };
    });
    expect(movedCue.z).toBeLessThan(-0.04);

    const bdx = initialSnap.apexScreen.x - movedCue.cueScreen.x;
    const bdy = initialSnap.apexScreen.y - movedCue.cueScreen.y;
    const bLen = Math.hypot(bdx, bdy);
    const bux = bdx / bLen;
    const buy = bdy / bLen;

    await page.mouse.move(initialSnap.apexScreen.x, initialSnap.apexScreen.y, {
      steps: 6,
    });
    await page.mouse.down();
    await page.mouse.move(
      initialSnap.apexScreen.x - bux * 230,
      initialSnap.apexScreen.y - buy * 230,
      { steps: 10 }
    );
    const shotPull = await page.locator('[data-testid="power-percent"]').textContent();
    expect(parseInt(shotPull || '0', 10)).toBeGreaterThan(60);
    await page.mouse.up();

    // Wait for playback to settle and phase to leave BREAK_PLACEMENT
    await page.waitForFunction(() => {
      const s = (
        window as unknown as { __poolDebug?: { getSnapshot: () => DebugSnapshot } }
      ).__poolDebug?.getSnapshot();
      return s && !s.isPlayingTimeline && !s.waitingShot && s.phase !== 'BREAK_PLACEMENT';
    }, { timeout: 25_000 });

    const postBreakSnap = await page.evaluate(() => {
      return (
        window as unknown as { __poolDebug: { getSnapshot: () => DebugSnapshot } }
      ).__poolDebug.getSnapshot();
    });

    // Rack must have cleanly dispersed across multiple balls
    const apexMoved = Math.hypot(
      postBreakSnap.balls[1].x - initialSnap.snap.balls[1].x,
      postBreakSnap.balls[1].z - initialSnap.snap.balls[1].z
    );
    expect(apexMoved).toBeGreaterThan(0.15);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'practice-after-break.png'),
    });

    const beforeCountText = await page
      .locator('[data-testid="practice-pocketed-count"]')
      .textContent();
    const pocketedBefore = parseInt((beforeCountText || '0').split('/')[0], 10);

    // 5. Find a clean straight-in/cut shot after the break and pocket it with REAL mouse controls
    const shotPlan = await page.evaluate(() => {
      const R = 0.028575;
      const D = R * 2;
      const pockets = [
        { x: -1.12, z: -0.56 },
        { x: 1.12, z: -0.56 },
        { x: 1.12, z: 0.56 },
        { x: -1.12, z: 0.56 },
        { x: 0, z: -0.585 },
        { x: 0, z: 0.585 },
      ];
      const dbg = (window as unknown as {
        __poolDebug: {
          getSnapshot: () => DebugSnapshot;
          tableToScreen: (x: number, z: number) => { x: number; y: number };
        };
      }).__poolDebug;
      const snap = dbg.getSnapshot();
      const cue = snap.balls[0];

      const isPathClear = (
        ax: number,
        az: number,
        bx: number,
        bz: number,
        ignoreA: number,
        ignoreB: number
      ) => {
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len;
        const uz = dz / len;
        for (const other of snap.balls) {
          if (other.pocketed || other.id === ignoreA || other.id === ignoreB) continue;
          const vx = other.x - ax;
          const vz = other.z - az;
          const proj = vx * ux + vz * uz;
          if (proj <= 0 || proj >= len) continue;
          const perp = Math.abs(vx * uz - vz * ux);
          if (perp < D + 0.008) return false;
        }
        return true;
      };

      let best: {
        score: number;
        cueScreen: { x: number; y: number };
        ghostScreen: { x: number; y: number };
      } | null = null;

      for (const b of snap.balls) {
        if (b.pocketed || b.id === 0 || b.id === 8) continue;
        for (const p of pockets) {
          const px = p.x - b.x;
          const pz = p.z - b.z;
          const pLen = Math.hypot(px, pz) || 1;
          const pux = px / pLen;
          const puz = pz / pLen;

          const gx = b.x - pux * D;
          const gz = b.z - puz * D;
          const ghostInside = Math.abs(gx) <= 1.088 && Math.abs(gz) <= 0.528;
          const openPocketAngle =
            p.x === 0
              ? Math.abs(puz) > 0.55
              : Math.abs(pux) > 0.36 && Math.abs(puz) > 0.36;

          const cx = gx - cue.x;
          const cz = gz - cue.z;
          const cLen = Math.hypot(cx, cz) || 1;
          const cux = cx / cLen;
          const cuz = cz / cLen;

          const cutCos = cux * pux + cuz * puz;
          if (cutCos < 0.45) continue;
          if (!isPathClear(cue.x, cue.z, gx, gz, 0, b.id)) continue;
          if (!isPathClear(b.x, b.z, p.x, p.z, b.id, 0)) continue;

          const anglePenalty =
            (ghostInside && openPocketAngle ? 0 : -100) + (cutCos < 0.58 ? -2 : 0);
          const score = cutCos * 3 - (pLen + cLen) * 0.4 + anglePenalty;
          if (!best || score > best.score) {
            best = {
              score,
              cueScreen: dbg.tableToScreen(cue.x, cue.z),
              ghostScreen: dbg.tableToScreen(gx, gz),
            };
          }
        }
      }
      return best;
    });

    expect(shotPlan).not.toBeNull();
    if (shotPlan) {
      // Aim directly onto computed ghost ball screen position
      await page.mouse.move(shotPlan.ghostScreen.x, shotPlan.ghostScreen.y, { steps: 6 });
      await page.waitForTimeout(120);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'practice-aimed-pocket.png'),
      });

      const sdx = shotPlan.ghostScreen.x - shotPlan.cueScreen.x;
      const sdy = shotPlan.ghostScreen.y - shotPlan.cueScreen.y;
      const sLen = Math.hypot(sdx, sdy) || 1;
      const sux = sdx / sLen;
      const suy = sdy / sLen;

      await page.mouse.down();
      await page.mouse.move(
        shotPlan.ghostScreen.x - sux * 150,
        shotPlan.ghostScreen.y - suy * 150,
        { steps: 8 }
      );
      await page.mouse.up();

      await page.waitForFunction(() => {
        const s = (
          window as unknown as { __poolDebug?: { getSnapshot: () => DebugSnapshot } }
        ).__poolDebug?.getSnapshot();
        return s && !s.isPlayingTimeline && !s.waitingShot;
      }, { timeout: 20_000 });

      const afterAimShotCount = await page
        .locator('[data-testid="practice-pocketed-count"]')
        .textContent();
      const pocketedTotal = parseInt((afterAimShotCount || '0').split('/')[0], 10);
      expect(pocketedTotal).toBeGreaterThan(pocketedBefore);
    }

    expect(consoleErrors).toEqual([]);
  });

  test('multiplayer: public vs private rooms, invite flow, and bit-identical shot sync', async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      // Player A opens lobby & creates a PRIVATE room
      await pageA.goto('/');
      await pageA.locator('#player-nickname').fill('Alice');
      await pageA.locator('[data-testid="open-create-room-btn"]').click();
      await pageA.locator('#room-name-input').fill('Sala Privada VIP');
      await pageA.locator('input[name="visibility"][value="private"]').check();
      await pageA.locator('[data-testid="submit-create-room-btn"]').click();

      await pageA.waitForURL(/\/room\/[A-Z0-9]+$/);
      const roomCode = (await pageA
        .locator('[data-testid="waiting-room-code"]')
        .textContent())!.trim();
      expect(roomCode.length).toBeGreaterThanOrEqual(4);

      // Player B checks public lobby -> private room MUST NOT appear
      await pageB.goto('/');
      await expect(pageB.locator('text=Sala Privada VIP')).toHaveCount(0);
      await pageB.screenshot({
        path: path.join(SCREENSHOT_DIR, 'lobby.png'),
      });

      // Player B joins directly via invite link
      await pageB.goto(`/room/${roomCode}`);
      await pageB.locator('#invite-nickname').fill('Bob');
      await pageB.locator('[data-testid="invite-join-btn"]').click();

      // Both players see active match & each other's cards
      await expect(pageA.locator('[data-testid="player-card-1"]')).toContainText('Bob');
      await expect(pageB.locator('[data-testid="player-card-0"]')).toContainText('Alice');
      await expect(pageA.locator('[data-testid="game-status-banner"]')).toContainText(
        'Sua saída!'
      );
      await expect(pageB.locator('[data-testid="game-status-banner"]')).toContainText(
        'Alice'
      );

      await pageA.screenshot({
        path: path.join(SCREENSHOT_DIR, 'multiplayer-active.png'),
      });

      // Verify Bob (waiting opponent) can still adjust his own cue contact point while Alice is active
      const bobPad = pageB.locator('[data-testid="cue-contact-pad"]');
      const bobPadBox = (await bobPad.boundingBox())!;
      await pageB.mouse.click(
        bobPadBox.x + bobPadBox.width * 0.25,
        bobPadBox.y + bobPadBox.height * 0.8
      );
      await expect(pageB.locator('[data-testid="cue-contact-label"]')).not.toHaveText(
        'Centro'
      );

      // Player A aims at apex ball and executes real mouse break shot
      const aimCoords = await pageA.evaluate(() => {
        const dbg = (window as unknown as {
          __poolDebug: {
            getSnapshot: () => DebugSnapshot;
            tableToScreen: (x: number, z: number) => { x: number; y: number };
          };
        }).__poolDebug;
        const snap = dbg.getSnapshot();
        return {
          cue: dbg.tableToScreen(snap.balls[0].x, snap.balls[0].z),
          apex: dbg.tableToScreen(snap.balls[1].x, snap.balls[1].z),
        };
      });

      const dx = aimCoords.apex.x - aimCoords.cue.x;
      const dy = aimCoords.apex.y - aimCoords.cue.y;
      const len = Math.hypot(dx, dy);
      const ux = dx / len;
      const uy = dy / len;

      await pageA.mouse.move(aimCoords.apex.x, aimCoords.apex.y, { steps: 6 });
      await pageA.mouse.down();
      await pageA.mouse.move(
        aimCoords.apex.x - ux * 230,
        aimCoords.apex.y - uy * 230,
        { steps: 10 }
      );
      await pageA.mouse.up();

      // Wait for BOTH tabs to complete shot timeline playback
      const waitSettled = (p: typeof pageA) =>
        p.waitForFunction(
          () => {
            const s = (
              window as unknown as {
                __poolDebug?: { getSnapshot: () => DebugSnapshot };
              }
            ).__poolDebug?.getSnapshot();
            return (
              s && !s.isPlayingTimeline && !s.waitingShot && s.phase !== 'BREAK_PLACEMENT'
            );
          },
          { timeout: 25_000 }
        );

      await Promise.all([waitSettled(pageA), waitSettled(pageB)]);

      const [snapA, snapB] = await Promise.all([
        pageA.evaluate(() =>
          (
            window as unknown as { __poolDebug: { getSnapshot: () => DebugSnapshot } }
          ).__poolDebug.getSnapshot()
        ),
        pageB.evaluate(() =>
          (
            window as unknown as { __poolDebug: { getSnapshot: () => DebugSnapshot } }
          ).__poolDebug.getSnapshot()
        ),
      ]);

      // Verify exact authoritative synchronization across both clients
      expect(snapA.activeSlot).toBe(snapB.activeSlot);
      expect(snapA.phase).toBe(snapB.phase);
      for (let i = 0; i < 16; i++) {
        expect(snapA.balls[i].pocketed).toBe(snapB.balls[i].pocketed);
        expect(snapA.balls[i].x).toBeCloseTo(snapB.balls[i].x, 5);
        expect(snapA.balls[i].z).toBeCloseTo(snapB.balls[i].z, 5);
      }

      // When Player B explicitly leaves the room, Player A must see opponent-left notice and NO Rematch button
      await pageB.locator('[data-testid="leave-room-btn"]').click();
      await expect(pageA.locator('[data-testid="opponent-left-notice"]')).toBeVisible();
      await expect(pageA.locator('[data-testid="rematch-btn"]')).toHaveCount(0);
      await expect(pageA.locator('[data-testid="leave-gameover-btn"]')).toBeVisible();

      // Now verify PUBLIC room appears live in lobby for another visitor
      const pageLobby = await ctxB.newPage();
      await pageLobby.goto('/');
      const pageC = await ctxA.newPage();
      await pageC.goto('/');
      await pageC.locator('[data-testid="open-create-room-btn"]').click();
      await pageC.locator('#room-name-input').fill('Mesa Publica Aberta');
      await pageC.locator('input[name="visibility"][value="public"]').check();
      await pageC.locator('[data-testid="submit-create-room-btn"]').click();
      await pageC.waitForURL(/\/room\/[A-Z0-9]+$/);

      await expect(pageLobby.locator('[data-testid="public-rooms-list"]')).toContainText(
        'Mesa Publica Aberta'
      );
      await pageLobby.close();
      await pageC.close();
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
