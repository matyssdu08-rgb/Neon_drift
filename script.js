// =======================
// CONFIG
// =======================
const config = {
    maxSpeed: 1.8,           // x3+ vs before
    acceleration: 0.032,
    brakeForce: 0.055,
    friction: 0.978,
    maxSteerAngle: 0.12,
    steerSpeed: 0.006,
    wheelBase: 1.6,
    minTurnSpeed: 0.02,
    turnBoost: 2.2,
    roadWidth: 10,
    curbWidth: 0.8,
    roadSegments: 260,
    SPEED_TO_KMH: 200,

    // Collision
    barrierDistance: 5.8,    // half road width + curb — wall starts here from track centre
    carRadius: 1.3,          // approximate half-width of car
    barrierBounceFactor: 0.35,
    barrierFriction: 0.55,

    // Terrain
    grassFriction: 0.88,     // applied every frame when off-road (< 1 = extra drag)
    grassMaxSpeed: 0.55,     // speed cap on grass
};

// =======================
// SCENE / CAMERA / RENDERER
// =======================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a1a);
scene.fog = new THREE.Fog(0x0a0a1a, 180, 600);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById("canvas-container").appendChild(renderer.domElement);

window.addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

// =======================
// LIGHTS
// =======================
scene.add(new THREE.AmbientLight(0x8888bb, 0.5));

const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(150, 200, 120);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = sun.shadow.camera.bottom = -400;
sun.shadow.camera.right = sun.shadow.camera.top = 400;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 900;
sun.shadow.bias = -0.0002;
scene.add(sun);

const neonFill = new THREE.PointLight(0x0044ff, 0.4, 300);
neonFill.position.set(0, 50, 0);
scene.add(neonFill);

// =======================
// CANVAS TEXTURES
// =======================
function canvasTexture(size, draw) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    draw(c.getContext("2d"), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

const grassTex = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = "#0d2e0a";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 14000; i++) {
        const b = 20 + Math.random() * 40;
        ctx.fillStyle = `rgba(${b},${b + 40},${b},0.5)`;
        ctx.fillRect(Math.random() * s, Math.random() * s, Math.random() * 3 + 1, Math.random() * 3 + 1);
    }
});
grassTex.repeat.set(80, 80);

const roadTex = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 10000; i++) {
        const g = 30 + Math.random() * 30;
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1);
    }
    ctx.strokeStyle = "rgba(255,220,0,0.4)";
    ctx.lineWidth = 4;
    ctx.setLineDash([40, 40]);
    ctx.beginPath();
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s / 2, s);
    ctx.stroke();
});
roadTex.repeat.set(1, 5);

// =======================
// GROUND
// =======================
const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({ map: grassTex })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);

// =======================
// STARS
// =======================
{
    const geo = new THREE.BufferGeometry();
    const verts = [];
    for (let i = 0; i < 3000; i++) {
        verts.push((Math.random() - 0.5) * 2000, 100 + Math.random() * 300, (Math.random() - 0.5) * 2000);
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, transparent: true, opacity: 0.7 })));
}

// =======================
// TRACK CURVE
// =======================
const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -150),
    new THREE.Vector3(140, 0, -80),
    new THREE.Vector3(180, 0, 0),
    new THREE.Vector3(100, 0, 140),
    new THREE.Vector3(0, 0, 180),
    new THREE.Vector3(-140, 0, 80),
    new THREE.Vector3(-180, 0, 0),
    new THREE.Vector3(-100, 0, -140)
], true);

// Pre-sample the curve for fast nearest-point lookup
const CURVE_SAMPLES = 600;
const curveSamples = [];
for (let i = 0; i < CURVE_SAMPLES; i++) {
    curveSamples.push(curve.getPointAt(i / CURVE_SAMPLES));
}

/**
 * Returns { closestPoint, normal2D, dist }
 * closestPoint : nearest point on track centre-line (xz plane)
 * normal2D     : unit vector pointing FROM track centre TOWARD the car
 * dist         : distance from track centre to car (xz)
 */
function getTrackInfo(pos) {
    let minDist = Infinity, bestIdx = 0;
    for (let i = 0; i < CURVE_SAMPLES; i++) {
        const s = curveSamples[i];
        const dx = pos.x - s.x, dz = pos.z - s.z;
        const d = dx * dx + dz * dz;
        if (d < minDist) { minDist = d; bestIdx = i; }
    }
    const closest = curveSamples[bestIdx];
    const dist = Math.sqrt(minDist);
    const nx = dist > 0.001 ? (pos.x - closest.x) / dist : 0;
    const nz = dist > 0.001 ? (pos.z - closest.z) / dist : 1;
    return { closest, dist, nx, nz };
}

// =======================
// ROAD + CURBS + BARRIERS
// =======================
const roadGroup = new THREE.Group();
scene.add(roadGroup);

for (let i = 0; i < config.roadSegments; i++) {
    const t1 = i / config.roadSegments;
    const t2 = (i + 1) / config.roadSegments;
    const p1 = curve.getPointAt(t1);
    const p2 = curve.getPointAt(t2);
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    const angle = Math.atan2(dir.x, dir.z);
    const normal = new THREE.Vector3(-dir.z, 0, dir.x).normalize();

    // Road surface
    const road = new THREE.Mesh(
        new THREE.BoxGeometry(config.roadWidth, 0.12, len),
        new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85, metalness: 0.05 })
    );
    road.position.copy(p1).add(p2).multiplyScalar(0.5);
    road.position.y = 0.05;
    road.rotation.y = angle;
    road.receiveShadow = true;
    roadGroup.add(road);

    // Curbs + barriers
    for (let side of [-1, 1]) {
        const curb = new THREE.Mesh(
            new THREE.BoxGeometry(config.curbWidth, 0.18, len),
            new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0xff1111 : 0xffffff, roughness: 0.6 })
        );
        curb.position.copy(road.position)
            .add(normal.clone().multiplyScalar(side * (config.roadWidth / 2 + config.curbWidth / 2)));
        curb.position.y = 0.09;
        curb.rotation.y = angle;
        curb.castShadow = true;
        curb.receiveShadow = true;
        roadGroup.add(curb);

        const barrier = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.8, len),
            new THREE.MeshStandardMaterial({
                color: side === -1 ? 0x0088ff : 0xff4400,
                emissive: side === -1 ? 0x0033aa : 0x882200,
                emissiveIntensity: 0.6,
                roughness: 0.3,
                metalness: 0.5
            })
        );
        barrier.position.copy(road.position)
            .add(normal.clone().multiplyScalar(side * (config.roadWidth / 2 + config.curbWidth + 0.1)));
        barrier.position.y = 0.4;
        barrier.rotation.y = angle;
        roadGroup.add(barrier);
    }
}

// =======================
// FINISH LINE
// =======================
const finishPos   = curve.getPointAt(0);
const finishDir   = curve.getTangentAt(0);
const finishAngle = Math.atan2(finishDir.x, finishDir.z);
const finishNorm  = new THREE.Vector3(-finishDir.z, 0, finishDir.x).normalize();

const checkerTex = canvasTexture(512, (ctx, s) => {
    const sz = 64;
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            ctx.fillStyle = (x + y) % 2 ? "#111" : "#fff";
            ctx.fillRect(x * sz, y * sz, sz, sz);
        }
    }
});

const finishFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(config.roadWidth, 5),
    new THREE.MeshStandardMaterial({ map: checkerTex, transparent: true, opacity: 0.95 })
);
finishFloor.rotation.x = -Math.PI / 2;
finishFloor.position.copy(finishPos);
finishFloor.position.y = 0.07;
finishFloor.rotation.z = -finishAngle - Math.PI / 2;
scene.add(finishFloor);

function makeGlowPole(offset, color) {
    const group = new THREE.Group();

    const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 10, 12),
        new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.3 })
    );
    pole.position.y = 5;
    pole.castShadow = true;
    group.add(pole);

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.5, 0.15, 8, 20),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2, roughness: 0.2 })
    );
    ring.position.y = 10;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const bloom = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 8),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3 })
    );
    bloom.position.y = 10;
    group.add(bloom);

    const pl = new THREE.PointLight(color, 2, 30);
    pl.position.y = 10;
    group.add(pl);

    group.position.copy(finishPos).add(finishNorm.clone().multiplyScalar(offset));
    group.position.y = 0;
    return group;
}

scene.add(makeGlowPole(-5.5, 0x00d4ff));
scene.add(makeGlowPole(5.5, 0xff4400));

const beam = new THREE.Mesh(
    new THREE.BoxGeometry(12.2, 0.4, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.2 })
);
beam.position.copy(finishPos);
beam.position.y = 10;
beam.rotation.y = finishAngle;
scene.add(beam);

const bannerTex = canvasTexture(512, (ctx, s) => {
    const cols = 16, rows = 4;
    const cw = s / cols, rh = s / rows;
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            ctx.fillStyle = (x + y) % 2 ? "#111" : "#fff";
            ctx.fillRect(x * cw, y * rh, cw, rh);
        }
    }
});
const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(11.5, 1.5),
    new THREE.MeshStandardMaterial({ map: bannerTex, side: THREE.DoubleSide, transparent: true, opacity: 0.92 })
);
banner.position.copy(finishPos);
banner.position.y = 9.2;
banner.rotation.y = finishAngle;
scene.add(banner);

const finishBox = new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(finishPos.x, 1, finishPos.z),
    new THREE.Vector3(config.roadWidth, 4, 7)
);

// =======================
// AUDI R8 — GLB MODEL
// =======================
const car = new THREE.Group();
scene.add(car);

// Neon underglow light (always present)
const carGlow = new THREE.PointLight(0x00d4ff, 1.2, 10);
carGlow.position.set(0, 0.15, 0);
car.add(carGlow);

// Underglow strip mesh
const undergloMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.80, 0.04, 4.0),
    new THREE.MeshStandardMaterial({ color: 0x00d4ff, emissive: 0x00d4ff, emissiveIntensity: 2.5, roughness: 1 })
);
undergloMesh.position.set(0, 0.05, 0);
car.add(undergloMesh);

// Wheel groups for steering/rolling animation
const frontWheels = [];
const allWheels   = [];

// We'll populate these after the model loads by finding wheel meshes,
// or use dummy pivot groups at wheel positions for animation
const wheelOffsets = [
    [-0.95, 0.35,  1.30],  // front-left
    [ 0.95, 0.35,  1.30],  // front-right
    [-0.95, 0.35, -1.30],  // rear-left
    [ 0.95, 0.35, -1.30],  // rear-right
];
wheelOffsets.forEach((p, i) => {
    const pivot = new THREE.Group();
    pivot.position.set(...p);
    // invisible pivot for animation; real wheel meshes are children of GLB
    car.add(pivot);
    allWheels.push(pivot);
    if (i < 2) frontWheels.push(pivot);
});

// ── Load the GLB ──
const loadingEl = (() => {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:30;background:rgba(0,0,0,0.85);font-family:'Orbitron',monospace;color:#00d4ff;font-size:22px;letter-spacing:4px;flex-direction:column;gap:16px;";
    el.innerHTML = '<div>CHARGEMENT MODÈLE</div><div id="loadPct" style="font-size:14px;color:rgba(0,212,255,0.5);">0%</div>';
    document.body.appendChild(el);
    return el;
})();

// Inject GLTFLoader + DRACOLoader from CDN
function loadScript(src, cb) {
    const s = document.createElement("script");
    s.src = src;
    s.onload = cb;
    document.head.appendChild(s);
}

loadScript("https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js", () => {}); // already loaded

// Use THREE.js r128 compatible GLTFLoader
const gltfLoaderScript = document.createElement("script");
gltfLoaderScript.src = "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js";
document.head.appendChild(gltfLoaderScript);

const dracoScript = document.createElement("script");
dracoScript.src = "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/DRACOLoader.js";
document.head.appendChild(dracoScript);

let modelLoaded = false;

function initGLBLoader() {
    const dracoLoader = new THREE.DRACOLoader();
    dracoLoader.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/");

    const loader = new THREE.GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    loader.load(
        "Audi2.glb",
        (gltf) => {
            const model = gltf.scene;

            // Auto-scale: fit in a ~2.2 x 1.0 x 4.5 bounding box
            const box = new THREE.Box3().setFromObject(model);
            const size = new THREE.Vector3();
            box.getSize(size);
            const center = new THREE.Vector3();
            box.getCenter(center);

            const targetLength = 4.4;
            const scale = targetLength / size.z;
            model.scale.setScalar(scale);

            // Recompute after scale
            box.setFromObject(model);
            box.getCenter(center);
            const minY = box.min.y;

            // Centre model and sit it on y=0
            model.position.set(-center.x, -minY + 0.38, -center.z);

            // Couleur rouge Audi sur la carrosserie
            const redPaint = new THREE.MeshStandardMaterial({
                color: 0xcc0a0a,
                metalness: 0.85,
                roughness: 0.18,
            });

            model.traverse(child => {
                if (!child.isMesh) return;
                child.castShadow = true;
                child.receiveShadow = true;

                const mat = child.material;
                if (!mat) return;

                // Récupère le nom du matériau (ou du mesh) en minuscules
                const name = ((mat.name || "") + " " + (child.name || "")).toLowerCase();

                // On exclut les vitres, pneus, phares, intérieur, chrome
                const isExcluded =
                    name.includes("glass") || name.includes("vitre") ||
                    name.includes("window") || name.includes("wind") ||
                    name.includes("tire")  || name.includes("tyre")  ||
                    name.includes("wheel") || name.includes("roue")  ||
                    name.includes("rubber") ||
                    name.includes("light") || name.includes("lamp")  ||
                    name.includes("light") || name.includes("phare") ||
                    name.includes("chrome") || name.includes("metal_trim") ||
                    name.includes("interior") || name.includes("interieur") ||
                    name.includes("seat") || name.includes("dashboard") ||
                    name.includes("brake") || name.includes("disc") ||
                    name.includes("exhaust") || name.includes("engine");

                if (!isExcluded) {
                    // Applique le rouge uniquement si le matériau est
                    // relativement clair / coloré (= carrosserie probable)
                    const c = mat.color ? mat.color : null;
                    if (c) {
                        const brightness = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
                        // Carrosseries sont généralement claires ou colorées (pas noires)
                        if (brightness > 0.15) {
                            child.material = redPaint;
                        }
                    }
                }
            });

            car.add(model);
            modelLoaded = true;
            loadingEl.style.display = "none";
        },
        (xhr) => {
            if (xhr.total) {
                const pct = Math.round(xhr.loaded / xhr.total * 100);
                const el = document.getElementById("loadPct");
                if (el) el.textContent = pct + "%";
            }
        },
        (err) => {
            console.error("GLB load error:", err);
            loadingEl.innerHTML = '<div style="color:#ff4444">Erreur de chargement</div><div style="font-size:13px;color:#888;margin-top:10px;">Vérifiez que Audi2.glb est dans le même dossier</div>';
        }
    );
}

// Wait for both loaders to be available
let scriptsReady = 0;
function onLoaderScriptReady() {
    scriptsReady++;
    if (scriptsReady === 2) initGLBLoader();
}
gltfLoaderScript.onload = onLoaderScriptReady;
dracoScript.onload = onLoaderScriptReady;

// Spawn position
const spawnPos = curve.getPointAt(0.025);
const spawnDir = curve.getTangentAt(0.025);
car.position.copy(spawnPos);
car.rotation.y = Math.atan2(spawnDir.x, spawnDir.z);


// =======================
// TRACKSIDE PYLONS
// =======================
{
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0xff5500, emissive: 0xff2200, emissiveIntensity: 0.4 });
    for (let i = 0; i < config.roadSegments; i += 8) {
        const t    = i / config.roadSegments;
        const pt   = curve.getPointAt(t);
        const tang = curve.getTangentAt(t);
        const norm = new THREE.Vector3(-tang.z, 0, tang.x).normalize();
        for (let side of [-1, 1]) {
            const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.8, 6), pylonMat);
            pylon.position.copy(pt).add(norm.clone().multiplyScalar(side * (config.roadWidth / 2 + 1.8)));
            pylon.position.y = 0.4;
            scene.add(pylon);
        }
    }
}

// =======================
// IMPACT FLASH (HUD)
// =======================
let impactFlashTime = 0;
const impactEl = (() => {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:13;border:6px solid transparent;border-radius:4px;transition:border-color 0.05s,opacity 0.15s;opacity:0;";
    document.body.appendChild(el);
    return el;
})();

function triggerImpactFlash() {
    impactEl.style.borderColor = "#ff4400";
    impactEl.style.opacity = "1";
    impactFlashTime = 0.25;
}

// =======================
// GAME STATE
// =======================
const keys = {};
let speed = 0, steer = 0;
let game = false;
let lapStarted = false;
let startTime  = 0;

// Velocity vector (world space, xz) for realistic bounce
let velX = 0, velZ = 0;

window.addEventListener("keydown", e => {
    // Ne pas capturer si le champ pseudo est actif
    if (document.activeElement && document.activeElement.id === "prompt-input") return;
    const prompt = document.getElementById("name-prompt");
    if (prompt && prompt.style.display === "flex") return;
    keys[e.key] = true;
    e.preventDefault();
});
window.addEventListener("keyup", e => {
    if (document.activeElement && document.activeElement.id === "prompt-input") return;
    const prompt = document.getElementById("name-prompt");
    if (prompt && prompt.style.display === "flex") return;
    keys[e.key] = false;
});

// =======================
// UPDATE
// =======================
function update(delta) {
    const d = delta * 60;

    // ── Steering ──
    if (keys["q"]) steer += config.steerSpeed * d;
    if (keys["d"]) steer -= config.steerSpeed * d;
    steer *= Math.pow(0.85, d);
    steer = THREE.MathUtils.clamp(steer, -config.maxSteerAngle, config.maxSteerAngle);

    // ── Rotation from steering ──
    const rot = (Math.abs(speed) + config.minTurnSpeed)
        * Math.tan(steer) * config.turnBoost * d / config.wheelBase;
    car.rotation.y += rot * (speed >= 0 ? 1 : -1);

    // ── Track surface check ──
    const { dist: trackDist } = getTrackInfo(car.position);
    const onGrass = trackDist > (config.roadWidth / 2 + config.curbWidth);

    // ── Throttle / Brake ──
    if (keys["z"]) speed += config.acceleration * d;
    if (keys["s"]) speed -= config.brakeForce * d;

    // Grass speed cap
    if (onGrass) {
        const grassCap = config.grassMaxSpeed;
        if (Math.abs(speed) > grassCap) speed *= config.grassFriction;
        speed *= Math.pow(config.grassFriction, d * 0.5);
    }

    speed = THREE.MathUtils.clamp(speed, -config.maxSpeed * 0.4, config.maxSpeed);

    // ── Base friction ──
    speed *= Math.pow(config.friction, d);

    // ── Move car (derive velocity from speed + heading) ──
    const headingX = Math.sin(car.rotation.y);
    const headingZ = Math.cos(car.rotation.y);
    velX = headingX * speed;
    velZ = headingZ * speed;

    car.position.x += velX * d;
    car.position.z += velZ * d;

    // ── Barrier collision ──
    const info = getTrackInfo(car.position);
    const wallDist = config.barrierDistance - config.carRadius;

    if (info.dist > wallDist) {
        // Push car back inside the barrier
        const overlap = info.dist - wallDist;
        car.position.x -= info.nx * overlap;
        car.position.z -= info.nz * overlap;

        // Reflect velocity component along normal (bounce)
        const vDotN = velX * info.nx + velZ * info.nz;
        if (vDotN > 0) { // only if moving INTO the wall
            const bounceScale = (1 + config.barrierBounceFactor);
            velX -= bounceScale * vDotN * info.nx;
            velZ -= bounceScale * vDotN * info.nz;

            // Derive new speed scalar from reflected velocity
            const newSpeedMag = Math.sqrt(velX * velX + velZ * velZ);
            // Check if new heading roughly aligns with car forward or backward
            const dot = velX * headingX + velZ * headingZ;
            speed = newSpeedMag * (dot >= 0 ? 1 : -1) * config.barrierFriction;

            triggerImpactFlash();
        }
    }

    // ── Wheel animation ──
    const rollSpeed = speed * d * 2.5;
    // Animate pivot groups (steering + roll for front, roll only for rear)
    allWheels.forEach(w => { w.rotation.x += rollSpeed; });
    frontWheels.forEach(w => { w.rotation.y = steer * 8; });

    // ── Underglow intensity ──
    carGlow.intensity = 0.7 + Math.abs(speed) * 1.2;

    // ── Impact flash fade ──
    if (impactFlashTime > 0) {
        impactFlashTime -= delta;
        if (impactFlashTime <= 0) {
            impactEl.style.opacity = "0";
            impactEl.style.borderColor = "transparent";
        }
    }

    // ── HUD ──
    document.getElementById("speed").innerHTML =
        Math.abs(speed * config.SPEED_TO_KMH).toFixed(0) + ' <span>km/h</span>';
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(3);
    document.getElementById("timer").innerHTML = elapsed + ' <span>s</span>';

    // ── Minimap ──
    drawMinimap();

    // ── Lap detection ──
    if (!lapStarted && car.position.distanceTo(finishPos) > 40) lapStarted = true;
    if (lapStarted && finishBox.containsPoint(car.position)) endRace(elapsed);
}

// =======================
// CAMERA
// =======================
function updateCamera() {
    const offset = new THREE.Vector3(0, 5.5, -12);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), car.rotation.y);
    camera.position.lerp(car.position.clone().add(offset), 0.12);
    camera.lookAt(car.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
}

// =======================
// RENDER LOOP
// =======================
const clock = new THREE.Clock();
(function loop() {
    requestAnimationFrame(loop);
    if (game) {
        const d = Math.min(clock.getDelta(), 0.05);
        update(d);
        updateCamera();
    }
    renderer.render(scene, camera);
    if (game) drawMinimap();
})();

// =======================
// MINIMAP
// =======================
const minimapCanvas = document.getElementById("minimap");
const mmCtx = minimapCanvas.getContext("2d");
const MM_SIZE = 180;
const MM_PAD  = 14;

const mmPoints = [];
let mmMinX = Infinity, mmMaxX = -Infinity, mmMinZ = Infinity, mmMaxZ = -Infinity;
for (let i = 0; i <= 300; i++) {
    const p = curve.getPointAt(i / 300);
    mmMinX = Math.min(mmMinX, p.x); mmMaxX = Math.max(mmMaxX, p.x);
    mmMinZ = Math.min(mmMinZ, p.z); mmMaxZ = Math.max(mmMaxZ, p.z);
    mmPoints.push(p);
}
const mmRangeX = mmMaxX - mmMinX;
const mmRangeZ = mmMaxZ - mmMinZ;
const mmScale  = (MM_SIZE - MM_PAD * 2) / Math.max(mmRangeX, mmRangeZ);

function toMM(wx, wz) {
    return { x: MM_PAD + (wx - mmMinX) * mmScale, y: MM_PAD + (wz - mmMinZ) * mmScale };
}

function drawMinimap() {
    mmCtx.clearRect(0, 0, MM_SIZE, MM_SIZE);
    mmCtx.fillStyle = "rgba(0,0,0,0.6)";
    mmCtx.fillRect(0, 0, MM_SIZE, MM_SIZE);

    // Track background band
    mmCtx.beginPath();
    mmCtx.strokeStyle = "rgba(255,255,255,0.12)";
    mmCtx.lineWidth = 8;
    mmCtx.lineJoin = "round";
    for (let i = 0; i < mmPoints.length; i++) {
        const p = toMM(mmPoints[i].x, mmPoints[i].z);
        i === 0 ? mmCtx.moveTo(p.x, p.y) : mmCtx.lineTo(p.x, p.y);
    }
    mmCtx.closePath();
    mmCtx.stroke();

    // Neon centre line
    mmCtx.beginPath();
    mmCtx.strokeStyle = "rgba(0,180,255,0.55)";
    mmCtx.lineWidth = 2;
    for (let i = 0; i < mmPoints.length; i++) {
        const p = toMM(mmPoints[i].x, mmPoints[i].z);
        i === 0 ? mmCtx.moveTo(p.x, p.y) : mmCtx.lineTo(p.x, p.y);
    }
    mmCtx.closePath();
    mmCtx.stroke();

    // Finish line
    const fp = toMM(finishPos.x, finishPos.z);
    mmCtx.fillStyle = "#ffffff";
    mmCtx.fillRect(fp.x - 4, fp.y - 2, 8, 4);

    // Car arrow
    const cp = toMM(car.position.x, car.position.z);
    mmCtx.save();
    mmCtx.translate(cp.x, cp.y);
    mmCtx.rotate(-car.rotation.y);
    mmCtx.beginPath();
    mmCtx.moveTo(0, -7); mmCtx.lineTo(4, 4); mmCtx.lineTo(0, 2); mmCtx.lineTo(-4, 4);
    mmCtx.closePath();
    mmCtx.fillStyle = "#ff3333";
    mmCtx.shadowColor = "#ff3333";
    mmCtx.shadowBlur = 8;
    mmCtx.fill();
    mmCtx.restore();
}

drawMinimap();

// =======================
// MEILLEUR TEMPS (localStorage)
// =======================
let personalBest = parseFloat(localStorage.getItem("neonDrift_best")) || Infinity;

function updateBestTimeDisplay() {
    const el = document.getElementById("bestTime");
    if (el) el.innerHTML = personalBest < Infinity
        ? personalBest.toFixed(3) + ' <span>s</span>'
        : '— <span>s</span>';
}

function checkPersonalBest(timeFloat) {
    if (timeFloat < personalBest) {
        personalBest = timeFloat;
        localStorage.setItem("neonDrift_best", timeFloat.toFixed(3));
        updateBestTimeDisplay();
        return true;
    }
    return false;
}

updateBestTimeDisplay();

// =======================
// LEADERBOARD (JSONBin.io — partagé en ligne)
// =======================
const JSONBIN_ID  = "69a6e164ae596e708f5b0dab";
const JSONBIN_KEY = "$2a$10$vw8eR7zg2UQYF/CFTVjaEeL8vwq1ISlAvwUDrrcLIIDMpwm9b0FHO";
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const LB_MAX = 10;

async function fetchLeaderboard() {
    try {
        const res = await fetch(JSONBIN_URL + "/latest", {
            headers: { "X-Master-Key": JSONBIN_KEY }
        });
        const data = await res.json();
        return Array.isArray(data.record) ? data.record : [];
    } catch (e) {
        console.error("Erreur fetch leaderboard:", e);
        return [];
    }
}

async function pushLeaderboard(lb) {
    try {
        await fetch(JSONBIN_URL, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "X-Master-Key": JSONBIN_KEY
            },
            body: JSON.stringify(lb)
        });
    } catch (e) {
        console.error("Erreur push leaderboard:", e);
    }
}

// Soumet un temps — retourne { improved, rank } 
async function submitTime(playerName, timeFloat) {
    const lb = await fetchLeaderboard();

    const existing = lb.find(e => e.name === playerName);
    if (existing && existing.time <= timeFloat) {
        return { improved: false, rank: lb.findIndex(e => e.name === playerName) + 1 };
    }

    const filtered = lb.filter(e => e.name !== playerName);
    filtered.push({
        name: playerName,
        time: timeFloat,
        date: new Date().toLocaleDateString("fr-FR")
    });
    filtered.sort((a, b) => a.time - b.time);
    filtered.splice(LB_MAX);

    await pushLeaderboard(filtered);

    const rank = filtered.findIndex(e => e.name === playerName) + 1;
    return { improved: true, rank };
}

async function renderLeaderboard() {
    const container = document.getElementById("leaderboard-list");
    if (!container) return;
    container.innerHTML = '<div class="lb-empty">Chargement…</div>';

    const lb = await fetchLeaderboard();

    // Filtre l'entrée fictive initiale
    const real = lb.filter(e => e.time < 999);

    if (real.length === 0) {
        container.innerHTML = '<div class="lb-empty">Aucun temps enregistré</div>';
        return;
    }

    container.innerHTML = real.map((e, i) => {
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
        return `<div class="lb-row ${i === 0 ? "lb-first" : ""}">
            <span class="lb-rank">${medal}</span>
            <span class="lb-name">${e.name}</span>
            <span class="lb-time">${e.time.toFixed(3)}s</span>
            <span class="lb-date">${e.date}</span>
        </div>`;
    }).join("");
}

// =======================
// END RACE
// =======================
function endRace(timeStr) {
    game = false;
    lapStarted = false;
    speed = steer = velX = velZ = 0;

    const timeFloat = parseFloat(timeStr);

    const flash = document.getElementById("flash");
    flash.style.opacity = "0.8";
    setTimeout(() => flash.style.opacity = "0", 200);

    setTimeout(() => {
        checkPersonalBest(timeFloat);
        showNamePrompt(timeFloat);
    }, 400);
}

function showNamePrompt(timeFloat) {
    const overlay = document.getElementById("name-prompt");
    const input   = document.getElementById("prompt-input");
    const btn     = document.getElementById("prompt-confirm");

    document.getElementById("prompt-time").textContent = timeFloat.toFixed(3) + " s";
    overlay.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:999;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);";

    input.value = localStorage.getItem("neonDrift_playerName") || "";
    setTimeout(() => input.focus(), 100);

    // Clone le bouton pour supprimer les anciens listeners
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    async function confirm() {
        const name = input.value.trim() || "Anonyme";
        localStorage.setItem("neonDrift_playerName", name);
        overlay.style.display = "none";
        document.getElementById("lastTime").textContent = "⏱ Envoi du temps...";
        document.getElementById("menu").style.display = "flex";
        try {
            const { improved, rank } = await submitTime(name, timeFloat);
            const msg = improved
                ? (rank === 1 ? "🏆 Nouveau record mondial !" : "✅ Top " + rank + " mondial !")
                : "Pas mieux que ton record...";
            document.getElementById("lastTime").textContent = "⏱ " + timeFloat.toFixed(3) + " s — " + msg;
        } catch(e) {
            document.getElementById("lastTime").textContent = "⏱ " + timeFloat.toFixed(3) + " s — Temps enregistré localement";
        }
        renderLeaderboard();
    }

    newBtn.addEventListener("click", confirm);

    function onKey(e) {
        if (e.key === "Enter")  { confirm(); input.removeEventListener("keydown", onKey); }
        if (e.key === "Escape") { overlay.style.display = "none"; input.removeEventListener("keydown", onKey); }
    }
    input.addEventListener("keydown", onKey);
}

// =======================
// COUNTDOWN 3-2-1-GO
// =======================
function startCountdown(callback) {
    const overlay = document.getElementById("countdown");
    const num     = document.getElementById("countdown-number");
    overlay.style.display = "flex";

    const steps = [
        { text: "3",  cls: "red"    },
        { text: "2",  cls: "orange" },
        { text: "1",  cls: "green"  },
        { text: "GO", cls: "go"     }
    ];

    let i = 0;
    function show() {
        if (i >= steps.length) {
            overlay.style.display = "none";
            callback();
            return;
        }
        const s = steps[i];
        num.textContent = s.text;
        num.className   = s.cls;
        void num.offsetWidth;
        num.classList.add("animate");
        i++;
        setTimeout(show, 900);
    }
    show();
}

// =======================
// MENU
// =======================
renderLeaderboard(); // affiche le classement au démarrage
document.getElementById("playBtn").onclick = () => {
    document.getElementById("menu").style.display = "none";

    car.position.copy(spawnPos);
    car.rotation.y = Math.atan2(spawnDir.x, spawnDir.z);
    speed = steer = velX = velZ = 0;
    lapStarted = false;

    startCountdown(() => {
        startTime = performance.now();
        game = true;
        clock.getDelta();
    });
};