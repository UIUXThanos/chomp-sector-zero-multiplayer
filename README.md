# CHOMP // SECTOR ZERO Multiplayer (prototype)

A locally testable cooperative/PvP multiplayer conversion of the supplied 3D WebGL game. Retains `engine.js`, the existing maze geometry, the HUD and CSS aesthetic. Features private six-character invitation codes, up to four players in a room, host-controlled start, shared ghost waves and pickups in cooperative mode, and last-player-standing PvP.

## Requirements
Node.js 20 or newer. Python alone cannot run the multiplayer server.

## Run locally (Mac)
```sh
cd /path/to/chomp-multiplayer
npm install
npm start
```
Open http://localhost:3000 in two separate browser windows (or two computers on the same network, using your Mac's LAN address). Create a private room in one browser, enter its six-character code in the other, then press **START MATCH (HOST)**. Choose co-op or PvP **when creating** a room. All clients must use the same server URL and room code.

**Don't use** `python3 -m http.server` for the multiplayer edition: it cannot run `server.js` or Socket.IO.

## Where to change ghost counts
`server.js` → `const GHOSTS_PER_WAVE = [8, 15, 27, 40, 75];`

## Game rules
- Magazine: 18; pellets grant 1 reserve bullet; R reloads for 1.35 seconds; reloading without collected pellets is blocked.
- Co-op: same ghosts and pickups for everyone, ghost damage and kills are synchronized, wave advances when all ghosts are defeated.
- PvP: player hits decrease health; last surviving player wins. Shooting uses the same magazine and pickup mechanics.
- Players joining a match in progress are rejected. Rooms are forgotten if all players disconnect.
- The six-character code is for invitation/convenience, not authentication. Don't use it to protect sensitive information.

## GitHub + Render
1. Push this directory to GitHub (exclude `node_modules` and `.env`; `.gitignore` is included).
2. Render dashboard → **New** → **Web Service** → select repository.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Use one running instance; room state is stored in RAM, so deployments/restarts reset rooms. Render exposes the `PORT` env var; the app listens on it and host `0.0.0.0`.
5. Share your `https://YOUR-SERVICE.onrender.com` link; your friends enter the room code. On sleeping/free hosts there can be an initial startup delay.

## Scope and limitations
This is a playable multiplayer prototype, not a production-hardened shooter. Movement validation is basic; PvP aim/hits are server-calculated but player positions are client-reported. Disconnects cannot rejoin an active room. No accounts, persistence, match history, anti-cheat system, recovery on redeploy, or horizontally scaled state. Co-op opponent steering is grid-based and may look less smooth than the original game's local animation. Test on your Mac before sharing publicly.

Run syntax and geometry tests:
```sh
node --check server.js
node --check game.js
node --test tests/*.test.js
```


## Multiplayer v2 changes

- Ghosts now have white eyes and dark pupils facing the local player.
- **Reload is manual only**: press R. Empty-magazine and empty-reserve warnings are displayed; yellow pellets add one reserve bullet each.
- In co-op, **pellets and Easter eggs respawn whenever a new wave starts**. In PvP, they spawn at match start.
- Four blocky minifigure-inspired outfits are assigned by player slot: dark bat vigilante, purple-and-green clown, yellow claw hero, fiery skeleton rider. These are simplified original geometry rather than imported character assets.
- Four purple Easter-egg pickups are placed around the maze and grant 15 seconds of: **rifle** (rapid fire), **frenzy** (faster movement, reload and fire), **banana shots** (banana-shaped projectiles, increased damage), **poop shots** (brown swirl projectiles). The special projectiles use hitscan game logic with visual tracer models, not physics-driven moving projectiles.
- Server is authoritative for ammo, shared ghosts, pickups, kills, and player damage. Rooms still reset on server restart.

**To run:** `npm install` then `npm start`. Browse to `http://localhost:3000`. Do not use Python http.server for this edition. Run `npm test` for maze unit tests. Open two distinct browsers to check multiplayer behavior.

**Note:** Geometry and JavaScript syntax were checked, but cross-browser WebGL/gameplay and internet deployments must be verified on your own machine.
