import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';

(() => {
  'use strict';
  const canvas = document.getElementById('phoneCanvas');
  if (!canvas) return;

  const screen = document.getElementById('phoneScreen');
  const engineStatus = document.getElementById('phoneEngineStatus');
  const renderMode = document.getElementById('phoneRenderMode');
  const soundButton = document.getElementById('phoneSound');
  const soundLabel = document.getElementById('phoneSoundLabel');
  const tiltButton = document.getElementById('phoneTilt');
  const tiltLabel = document.getElementById('phoneTiltLabel');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarsePointer = matchMedia('(pointer: coarse)').matches;
  const MAX_OBJECTS = coarsePointer ? 26 : 38;
  const FIXED_STEP = 1 / 120;
  const MAX_FRAME_DELTA = 0.05;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const random = (min, max) => min + Math.random() * (max - min);
  const clock = new THREE.Clock();

  let renderer, scene, camera, world, pmrem;
  let floorMesh, backMesh;
  let viewHalfWidth = 1.9, viewHalfHeight = 3;
  let floorY = -2.65, ceilY = 2.65, sideX = 1.55;
  let soundEnabled = true, audioContext = null, masterGain = null, compressor = null;
  let liquidSoundSource = null, liquidSoundFilter = null, liquidSoundGain = null;
  let tiltEnabled = false, tiltReference = null;
  let gravityX = 0, gravityY = -12, gravityZ = 0;
  let targetGravityX = 0, targetGravityY = -12;
  let lastWakeGravity = {x:0,y:-12,z:0}, lastWakeAt = 0, lastCollisionSweep = 0;
  let paintMode = false, selectedPaintColor = '#a78bfa', liquidMode = null;
  let liquidLevel = -2, liquidTargetLevel = -1, liquidPouring = false;
  let liquidEnergy = 0, liquidSurfaceAccumulator = 0, nextPourWaveAt = 0;
  let liquidVolumeMesh = null, liquidSurfaceMesh = null, liquidPourMesh = null;
  const liquidWaveImpulses = [];
  let dragging = null, lastRender = 0, nextId = 1, soundClock = 0;
  const items = [];
  const bodies = new WeakMap();
  const walls = [];
  const activeEffects = [];
  const collisionTimes = new Map();
  const MAX_LIQUID_WAVES = coarsePointer ? 5 : 8;
  let maxDpr = coarsePointer ? 1.25 : 1.5;
  let animationHandle = 0;
  let fpsSamples = 0, fpsElapsed = 0, fpsScale = 1;
  const geometries = {};
  const materials = {};
  const textures = {};
  const physicsMaterials = {};

  function status(text) { if (engineStatus) engineStatus.textContent = text; }

  function makeCanvasTexture(draw, size = 256) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d', { alpha: true });
    draw(g, size);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;
    return texture;
  }

  function iceTexture() {
    return makeCanvasTexture((g, s) => {
      g.clearRect(0, 0, s, s);
      const fill = g.createLinearGradient(0, 0, s, s);
      fill.addColorStop(0, '#dffaff');
      fill.addColorStop(.27, '#a7e7ff');
      fill.addColorStop(.52, '#66b9e2');
      fill.addColorStop(.76, '#b7f2ff');
      fill.addColorStop(1, '#e9fdff');
      g.fillStyle = fill; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 1700; i++) {
        const shade = Math.random() > .5 ? '255,255,255' : '36,126,175';
        g.fillStyle = 'rgba(' + shade + ',' + random(.025, .13) + ')';
        const r = random(.3, 2.1);
        g.fillRect(random(0,s), random(0,s), r, r);
      }
      g.lineCap = 'round';
      for (let i = 0; i < 18; i++) {
        const x = random(0,s), y = random(0,s);
        const length = random(13, 68), dx = random(-length, length);
        g.beginPath(); g.moveTo(x,y); g.lineTo(x+dx*.46,y+random(-10,10)); g.lineTo(x+dx,y+random(-18,18));
        g.strokeStyle = 'rgba(255,255,255,' + random(.12,.42) + ')'; g.lineWidth = random(.5,1.8); g.stroke();
        if (Math.random() > .5) {
          g.beginPath(); g.moveTo(x+dx*.45,y+random(-5,5)); g.lineTo(x+dx*.5+random(-15,15),y+random(-28,28));
          g.strokeStyle = 'rgba(32,117,165,.28)'; g.lineWidth = .7; g.stroke();
        }
      }
      const edge = g.createRadialGradient(s*.42,s*.35,s*.04,s*.5,s*.5,s*.78);
      edge.addColorStop(0,'rgba(255,255,255,.12)'); edge.addColorStop(.7,'rgba(255,255,255,0)'); edge.addColorStop(1,'rgba(14,83,129,.18)');
      g.fillStyle=edge;g.fillRect(0,0,s,s);
    }, 256);
  }

  function ballTexture() {
    return makeCanvasTexture((g,s) => {
      g.fillStyle = '#f9f5ff'; g.fillRect(0,0,s,s);
      const stripe = g.createLinearGradient(0,0,s,s);
      stripe.addColorStop(0,'#ff4ea7'); stripe.addColorStop(.25,'#ab76ff');
      stripe.addColorStop(.5,'#43d9ff'); stripe.addColorStop(.74,'#88f0a5'); stripe.addColorStop(1,'#ffc65c');
      g.fillStyle=stripe;g.fillRect(0,0,s,s);
      for(let i=0;i<6;i++){
        g.beginPath();g.ellipse(s*.5,s*.5,s*.13+i*4,s*.48-i*2, i*.18,0,Math.PI*2);
        g.strokeStyle='rgba(255,255,255,'+(i%2?.12:.38)+')';g.lineWidth=i%2?1.5:3;g.stroke();
      }
      g.strokeStyle='rgba(25,22,48,.3)';g.lineWidth=2;
      g.beginPath();g.moveTo(0,s*.5);g.bezierCurveTo(s*.3,s*.35,s*.7,s*.65,s,s*.5);g.stroke();
    },256);
  }

  function plasticTexture() {
    return makeCanvasTexture((g,s) => {
      const grad=g.createLinearGradient(0,0,s,s);
      grad.addColorStop(0,'#e8e4ff');grad.addColorStop(.24,'#a191f4');grad.addColorStop(.55,'#665cc1');grad.addColorStop(1,'#26294f');
      g.fillStyle=grad;g.fillRect(0,0,s,s);
      for(let i=0;i<900;i++){g.fillStyle='rgba(255,255,255,'+random(.005,.055)+')';g.fillRect(random(0,s),random(0,s),random(.4,1.4),random(.4,1.4));}
      g.strokeStyle='rgba(255,255,255,.28)';g.lineWidth=2;
      g.beginPath();g.moveTo(s*.08,s*.18);g.lineTo(s*.55,s*.04);g.lineTo(s*.83,s*.17);g.stroke();
      g.beginPath();g.moveTo(s*.12,s*.84);g.lineTo(s*.58,s*.95);g.stroke();
    },256);
  }

  function redTexture() {
    return makeCanvasTexture((g,s) => {
      g.fillStyle='#cb2637';g.fillRect(0,0,s,s);
      g.fillStyle='rgba(255,255,255,.07)';
      for(let y=0;y<s;y+=13)g.fillRect(0,y,s,2);
      g.strokeStyle='rgba(40,0,5,.45)';g.lineWidth=4;
      g.strokeRect(11,11,s-22,s-22);
      for(let i=0;i<42;i++){g.fillStyle='rgba(255,255,255,'+random(.01,.07)+')';g.fillRect(random(0,s),random(0,s),random(1,4),random(1,4));}
    },256);
  }

  function tntLabelTexture() {
    const c=document.createElement('canvas');
    c.width=256;c.height=128;
    const g=c.getContext('2d');
    g.clearRect(0,0,c.width,c.height);
    g.fillStyle='rgba(38,3,10,.82)';g.fillRect(7,23,242,82);
    g.strokeStyle='rgba(255,236,213,.8)';g.lineWidth=4;g.strokeRect(10,26,236,76);
    g.fillStyle='#fff1df';g.font='900 55px Manrope,system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('TNT',128,65);
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=2;return texture;
  }

  function shadowTexture() {
    return makeCanvasTexture((g,s) => {
      const grad=g.createRadialGradient(s/2,s/2,1,s/2,s/2,s*.48);
      grad.addColorStop(0,'rgba(0,0,0,.55)');grad.addColorStop(.48,'rgba(0,0,0,.24)');grad.addColorStop(1,'rgba(0,0,0,0)');
      g.fillStyle=grad;g.fillRect(0,0,s,s);
    },128);
  }

  function createMaterials() {
    textures.ice = iceTexture();
    textures.ball = ballTexture();
    textures.plastic = plasticTexture();
    textures.red = redTexture();
    textures.tntLabel = tntLabelTexture();
    textures.shadow = shadowTexture();

    materials.ice = new THREE.MeshPhysicalMaterial({
      color: 0xb7edff, map: textures.ice, roughness: .17, metalness: 0,
      clearcoat: .95, clearcoatRoughness: .12, transparent: true, opacity: .9,
      bumpMap: textures.ice, bumpScale: .025,
      side: THREE.DoubleSide, envMapIntensity: 1.6, depthWrite: false
    });
    materials.ball = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: textures.ball, roughness: .2, metalness: .02,
      clearcoat: 1, clearcoatRoughness: .1, envMapIntensity: 1.4
    });
    materials.cube = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: textures.plastic, roughness: .26, metalness: .08,
      clearcoat: .85, clearcoatRoughness: .18, bumpMap: textures.plastic, bumpScale: .012, envMapIntensity: 1.5
    });
    materials.tnt = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: textures.red, roughness: .32, metalness: .01,
      clearcoat: .5, clearcoatRoughness: .25, envMapIntensity: 1.1
    });
    materials.tntLabel = new THREE.MeshBasicMaterial({ map: textures.tntLabel, transparent: true, opacity: .98, side: THREE.DoubleSide, depthWrite: false });
    materials.shadow = new THREE.MeshBasicMaterial({
      map: textures.shadow, transparent: true, opacity: .7, depthWrite: false, color: 0x8d93b8
    });
    materials.floor = new THREE.MeshStandardMaterial({ color: 0x15192b, roughness: .5, metalness: .14 });
    materials.back = new THREE.MeshBasicMaterial({ color: 0x090d19 });
    materials.ring = new THREE.MeshBasicMaterial({ color: 0xffbc71, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide });
    materials.waterVolume = new THREE.MeshPhysicalMaterial({
      color:0x159bd7,roughness:.12,metalness:.02,transparent:true,opacity:.29,
      clearcoat:1,clearcoatRoughness:.08,envMapIntensity:1.4,depthWrite:false,
      side:THREE.DoubleSide
    });
    materials.waterSurface = new THREE.MeshPhysicalMaterial({
      color:0x48caff,roughness:.065,metalness:.06,transparent:true,opacity:.88,
      clearcoat:1,clearcoatRoughness:.025,envMapIntensity:1.8,depthWrite:false,
      side:THREE.DoubleSide
    });
    materials.waterStream = new THREE.MeshPhysicalMaterial({
      color:0x67dcff,roughness:.07,metalness:.01,transparent:true,opacity:.79,
      clearcoat:1,clearcoatRoughness:.035,depthWrite:false,side:THREE.DoubleSide
    });
    materials.slimeVolume = new THREE.MeshPhysicalMaterial({
      color:0x4bbd28,roughness:.18,metalness:.01,transparent:true,opacity:.48,
      clearcoat:1,clearcoatRoughness:.055,envMapIntensity:1.25,depthWrite:false,
      side:THREE.DoubleSide
    });
    materials.slimeSurface = new THREE.MeshPhysicalMaterial({
      color:0x84ef45,roughness:.11,metalness:.01,transparent:true,opacity:.94,
      clearcoat:1,clearcoatRoughness:.04,envMapIntensity:1.35,depthWrite:false,
      side:THREE.DoubleSide
    });
    materials.slimeStream = new THREE.MeshPhysicalMaterial({
      color:0x8df34e,roughness:.13,metalness:0,transparent:true,opacity:.9,
      clearcoat:1,clearcoatRoughness:.06,depthWrite:false,side:THREE.DoubleSide
    });
  }

  function createRenderer() {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: !coarsePointer, alpha: false, powerPreference: 'high-performance',
      stencil: false, depth: true, preserveDrawingBuffer: false
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setClearColor(0x080a13, 1);
    renderer.info.autoReset = true;
  }

  function createOpenLiquidVolumeGeometry(){
    const faces=[
      [[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]],
      [[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]],
      [[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]],
      [[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]],
      [[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]]
    ];
    const positions=[];
    const indices=[];
    for(const face of faces){
      const base=positions.length/3;
      for(const vertex of face)positions.push(vertex[0],vertex[1],vertex[2]);
      indices.push(base,base+1,base+2,base,base+2,base+3);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function createScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080a13);
    scene.fog = new THREE.Fog(0x080a13, 10, 24);
    camera = new THREE.PerspectiveCamera(38, 1, .1, 60);
    camera.position.set(0, 0, 9);
    camera.lookAt(0,0,0);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const envScene = new RoomEnvironment();
    pmrem = pmremGenerator.fromScene(envScene, .035).texture;
    scene.environment = pmrem;
    envScene.dispose?.();
    pmremGenerator.dispose();

    scene.add(new THREE.HemisphereLight(0xc9e5ff, 0x171323, 1.8));
    const key = new THREE.DirectionalLight(0xfff1df, 2.4);
    key.position.set(-3.5, 5, 6);
    scene.add(key);
    const fill = new THREE.PointLight(0x698aff, 28, 11, 2);
    fill.position.set(2.1, 1.5, 2);
    scene.add(fill);
    const rim = new THREE.PointLight(0x5ce7ff, 18, 9, 2);
    rim.position.set(-2, -1, 1.5);
    scene.add(rim);
    const topGlow = new THREE.PointLight(0xff6cc7, 9, 8, 2);
    topGlow.position.set(0, 3.4, 0);
    scene.add(topGlow);

    geometries.sphere = new THREE.SphereGeometry(.22, coarsePointer ? 22 : 30, coarsePointer ? 16 : 22);
    geometries.cube = new RoundedBoxGeometry(.45,.45,.45,3,.055);
    geometries.ice = new RoundedBoxGeometry(.48,.48,.48,3,.045);
    geometries.tnt = new RoundedBoxGeometry(.49,.49,.49,3,.035);
    geometries.tntLabel = new THREE.PlaneGeometry(.4,.2);
    geometries.liquidVolume = createOpenLiquidVolumeGeometry();
    geometries.liquidSurface = new THREE.PlaneGeometry(1,1,coarsePointer?24:38,coarsePointer?8:12);
    geometries.liquidSurface.rotateX(-Math.PI/2);
    geometries.liquidPour = new THREE.CylinderGeometry(.035,.075,1,coarsePointer?7:10,1,true);
    geometries.shadow = new THREE.PlaneGeometry(1,1);
    geometries.floor = new THREE.BoxGeometry(1,.12,1.2);
    geometries.ring = new THREE.TorusGeometry(.12,.018,5,42);

    backMesh = new THREE.Mesh(new THREE.PlaneGeometry(20,20), materials.back);
    backMesh.position.z = -2.3;
    scene.add(backMesh);

    floorMesh = new THREE.Mesh(geometries.floor, materials.floor);
    floorMesh.position.z = -.3;
    scene.add(floorMesh);

    liquidVolumeMesh = new THREE.Mesh(geometries.liquidVolume, materials.waterVolume);
    liquidVolumeMesh.visible = false;
    liquidVolumeMesh.renderOrder = 2;
    scene.add(liquidVolumeMesh);
    liquidSurfaceMesh = new THREE.Mesh(geometries.liquidSurface, materials.waterSurface);
    liquidSurfaceMesh.visible = false;
    liquidSurfaceMesh.renderOrder = 3;
    scene.add(liquidSurfaceMesh);
    liquidPourMesh = new THREE.Mesh(geometries.liquidPour, materials.waterStream);
    liquidPourMesh.visible = false;
    liquidPourMesh.renderOrder = 4;
    scene.add(liquidPourMesh);

    const stars = new THREE.BufferGeometry();
    const starCount = coarsePointer ? 65 : 100;
    const positions = new Float32Array(starCount * 3);
    for(let i=0;i<starCount;i++){
      positions[i*3]=random(-2.5,2.5);
      positions[i*3+1]=random(-3.2,3.2);
      positions[i*3+2]=-1.5;
    }
    stars.setAttribute('position',new THREE.BufferAttribute(positions,3));
    const starMesh = new THREE.Points(stars,new THREE.PointsMaterial({color:0x929bd1,size:.012,transparent:true,opacity:.45,sizeAttenuation:true,depthWrite:false}));
    scene.add(starMesh);
  }

  function makeWall(position, halfExtents) {
    const body = new CANNON.Body({ mass: 0, material: physicsMaterials.wall, shape: new CANNON.Box(new CANNON.Vec3(halfExtents.x, halfExtents.y, halfExtents.z)) });
    body.position.set(position.x,position.y,position.z);
    body.collisionFilterGroup = 1;
    body.collisionFilterMask = 1;
    world.addBody(body);
    walls.push(body);
  }

  function rebuildWalls() {
    for(const wall of walls)world.removeBody(wall);
    walls.length=0;
    const x = viewHalfWidth;
    const y = viewHalfHeight;
    sideX = Math.max(1.2,x-.24);
    floorY = -y+.25;
    ceilY = y-.25;
    makeWall({x:-x+.07,y:0,z:0},{x:.07,y:y,z:1.3});
    makeWall({x:x-.07,y:0,z:0},{x:.07,y:y,z:1.3});
    makeWall({x:0,y:floorY-.07,z:0},{x:x,y:.07,z:1.3});
    makeWall({x:0,y:ceilY+.07,z:0},{x:x,y:.07,z:1.3});
    makeWall({x:0,y:0,z:-.95},{x:x,y:y,z:.08});
    makeWall({x:0,y:0,z:.92},{x:x,y:y,z:.08});

    floorMesh.scale.set(x*2,.12,1);
    floorMesh.position.y=floorY-.08;
    floorMesh.position.z=-.26;
    backMesh.scale.set(x*.24,y*.18,1);
    updateLiquidLayout();
  }

  function createPhysics() {
    world = new CANNON.World({ gravity: new CANNON.Vec3(0,-12,0), allowSleep: true });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.solver.iterations = coarsePointer ? 9 : 13;
    world.solver.tolerance = .001;
    world.allowSleep = true;
    world.defaultContactMaterial.friction = .34;
    world.defaultContactMaterial.restitution = .2;
    world.defaultContactMaterial.contactEquationStiffness = 1e7;
    world.defaultContactMaterial.contactEquationRelaxation = 3;
    world.defaultContactMaterial.contactEquationRegularizationTime = 3;
    physicsMaterials.wall = new CANNON.Material('wall');
    physicsMaterials.rubber = new CANNON.Material('rubber');
    physicsMaterials.ice = new CANNON.Material('ice');
    physicsMaterials.cube = new CANNON.Material('cube');
    physicsMaterials.tnt = new CANNON.Material('tnt');
    const contact = (a,b,friction,restitution) => world.addContactMaterial(new CANNON.ContactMaterial(
      physicsMaterials[a],physicsMaterials[b],{friction,restitution,contactEquationStiffness:1e7,contactEquationRelaxation:4}
    ));
    contact('rubber','rubber',.36,.87);
    contact('rubber','ice',.24,.72);
    contact('rubber','cube',.32,.74);
    contact('rubber','tnt',.34,.68);
    contact('ice','ice',.12,.57);
    contact('ice','cube',.2,.49);
    contact('ice','tnt',.2,.46);
    contact('cube','cube',.34,.42);
    contact('cube','tnt',.32,.38);
    contact('tnt','tnt',.3,.34);
    for(const kind of ['rubber','ice','cube','tnt']){
      const settings=kind==='rubber'?{friction:.35,restitution:.82}:kind==='ice'?{friction:.2,restitution:.61}:kind==='cube'?{friction:.42,restitution:.35}:{friction:.4,restitution:.3};
      world.addContactMaterial(new CANNON.ContactMaterial(physicsMaterials[kind],physicsMaterials.wall,{...settings,contactEquationStiffness:1e7,contactEquationRelaxation:4}));
    }
    world.gravity.set(gravityX,gravityY,gravityZ);
    rebuildWalls();
  }

  function addTntLabel(mesh) {
    const sticker=new THREE.Mesh(geometries.tntLabel,materials.tntLabel);
    sticker.position.set(0,0,.249);
    mesh.add(sticker);
    return sticker;
  }

  function addItem(kind, position, velocity, options = {}) {
    if(items.length >= MAX_OBJECTS) {
      const removeIndex=items.findIndex(x=>x.kind!=='tnt' && x!==dragging?.item);
      if(removeIndex>=0)removeItem(items[removeIndex]);
      else if(items.length>=MAX_OBJECTS+2)return null;
    }
    const scale = kind==='rubber' ? random(.78,1.12) : kind==='ice' ? random(.86,1.13) : kind==='tnt' ? 1 : random(.85,1.2);
    let mesh, shape, mass, mat;
    if(kind==='rubber'){
      mat=materials.ball.clone();
      mesh=new THREE.Mesh(geometries.sphere,mat);
      mesh.scale.setScalar(scale);
      shape=new CANNON.Sphere(.22*scale);
      mass=.62*scale;
    } else if(kind==='ice'){
      mat=materials.ice.clone();
      mesh=new THREE.Mesh(geometries.ice,mat);
      mesh.scale.setScalar(scale);
      shape=new CANNON.Box(new CANNON.Vec3(.23*scale,.23*scale,.23*scale));
      mass=.82*scale;
    } else if(kind==='tnt'){
      mat=materials.tnt.clone();
      mesh=new THREE.Mesh(geometries.tnt,mat);
      shape=new CANNON.Box(new CANNON.Vec3(.235,.235,.235));
      mass=1.15;
    } else {
      mat=materials.cube.clone();
      mesh=new THREE.Mesh(geometries.cube,mat);
      mesh.scale.setScalar(scale);
      shape=new CANNON.Box(new CANNON.Vec3(.22*scale,.22*scale,.22*scale));
      mass=.78*scale;
    }
    mesh.castShadow=false;
    mesh.receiveShadow=false;
    mesh.position.set(position.x,position.y,position.z);
    scene.add(mesh);
    if(kind==='tnt')addTntLabel(mesh);
    const shadow=new THREE.Mesh(geometries.shadow,materials.shadow);
    shadow.rotation.x=-Math.PI/2;
    shadow.position.set(position.x,floorY+.01,position.z-.02);
    shadow.scale.set(.56,.56,1);
    scene.add(shadow);

    const body=new CANNON.Body({
      mass, material:physicsMaterials[kind], shape, position:new CANNON.Vec3(position.x,position.y,position.z),
      linearDamping: kind==='rubber'?.065 : kind==='ice'?.028 : .055,
      angularDamping: kind==='rubber'?.12 : kind==='ice'?.095 : .11,
      allowSleep:true, sleepSpeedLimit:.12, sleepTimeLimit:.65
    });
    body.userData={kind};
    body.angularVelocity.set(random(-.45,.45),random(-.45,.45),random(-.75,.75));
    body.velocity.set(velocity?.x ?? random(-1.2,1.2),velocity?.y ?? random(-.6,.5),velocity?.z ?? random(-.55,.55));
    world.addBody(body);
    const item={id:nextId++,kind,mesh,body,shadow,material:mat,mass,scale,radius:kind==='rubber'?.22*scale:.39*scale,
      fuseAt:options.fuseAt||0,lastSound:0};
    body.userData.item=item;
    bodies.set(body,item);
    body.addEventListener('collide', event=>onCollision(item,event));
    items.push(item);
    item.liquidSubmerged=0;
    return item;
  }

  function removeItem(item) {
    const i=items.indexOf(item);
    if(i<0)return;
    items.splice(i,1);
    world.removeBody(item.body);
    scene.remove(item.mesh);
    scene.remove(item.shadow);
    item.material?.dispose();
    item.body.removeAllEventListeners?.();
    if(dragging?.item===item)dragging=null;
  }

  function itemCenter(item) {
    return new THREE.Vector3(item.body.position.x,item.body.position.y,item.body.position.z);
  }

  function createSound() {
    if(!soundEnabled)return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if(!Audio)return;
    try{
      if(!audioContext){
        audioContext=new Audio();
        masterGain=audioContext.createGain();
        masterGain.gain.value=.48;
        compressor=audioContext.createDynamicsCompressor();
        compressor.threshold.value=-18;
        compressor.knee.value=18;
        compressor.ratio.value=3.5;
        compressor.attack.value=.004;
        compressor.release.value=.18;
        masterGain.connect(compressor);
        compressor.connect(audioContext.destination);
      }
      if(audioContext.state==='suspended')audioContext.resume();
    }catch(error){ console.warn('Audio is unavailable',error); }
  }

  function connectVoice(node,gain,x=0){
    const panner=audioContext.createStereoPanner ? audioContext.createStereoPanner() : null;
    if(panner){
      panner.pan.value=clamp(x/(sideX||1),-1,1)*.65;
      node.connect(gain);gain.connect(panner);panner.connect(masterGain);
    }else{node.connect(gain);gain.connect(masterGain);}
  }

  function voice(freq,duration,type,volume,curve='exp',x=0,detune=0){
    if(!soundEnabled)return;
    createSound();
    if(!audioContext || !masterGain)return;
    const t=audioContext.currentTime;
    const osc=audioContext.createOscillator();
    const gain=audioContext.createGain();
    osc.type=type||'sine';
    osc.frequency.setValueAtTime(Math.max(25,freq),t);
    if(detune)osc.detune.value=detune;
    if(curve==='down')osc.frequency.exponentialRampToValueAtTime(Math.max(25,freq*.42),t+duration*.75);
    gain.gain.setValueAtTime(.0001,t);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002,volume),t+.004);
    gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    connectVoice(osc,gain,x);
    osc.start(t);
    osc.stop(t+duration+.025);
  }

  function startLiquidSound(mode){
    if(!soundEnabled||!mode){stopLiquidSound();return;}
    createSound();
    if(!audioContext||!masterGain)return;
    stopLiquidSound();
    const length=Math.floor(audioContext.sampleRate*2.2);
    const buffer=audioContext.createBuffer(1,length,audioContext.sampleRate);
    const data=buffer.getChannelData(0);
    let low=0;
    for(let i=0;i<length;i++){
      const white=Math.random()*2-1;
      low=low*.91+white*.09;
      data[i]=mode==='water'?(white*.22+low*.78):(low*.85+white*.15);
    }
    liquidSoundSource=audioContext.createBufferSource();
    liquidSoundSource.buffer=buffer;
    liquidSoundSource.loop=true;
    liquidSoundFilter=audioContext.createBiquadFilter();
    liquidSoundFilter.type=mode==='water'?'bandpass':'lowpass';
    liquidSoundFilter.frequency.value=mode==='water'?1850:620;
    liquidSoundFilter.Q.value=mode==='water'?.45:.7;
    liquidSoundGain=audioContext.createGain();
    liquidSoundGain.gain.value=.0001;
    liquidSoundSource.connect(liquidSoundFilter);
    liquidSoundFilter.connect(liquidSoundGain);
    liquidSoundGain.connect(masterGain);
    liquidSoundSource.start();
    liquidSoundGain.gain.setTargetAtTime(mode==='water'?.022:.032,audioContext.currentTime,.24);
  }

  function stopLiquidSound(){
    if(!liquidSoundSource)return;
    const source=liquidSoundSource,gain=liquidSoundGain,filter=liquidSoundFilter;
    if(gain&&audioContext){
      gain.gain.cancelScheduledValues(audioContext.currentTime);
      gain.gain.setTargetAtTime(.0001,audioContext.currentTime,.07);
    }
    try{source.stop(audioContext.currentTime+.32);}catch(_){}
    source.onended=()=>{
      try{source.disconnect();}catch(_){}
      try{filter?.disconnect();}catch(_){}
      try{gain?.disconnect();}catch(_){}
    };
    liquidSoundSource=null;liquidSoundFilter=null;liquidSoundGain=null;
  }

  function noiseBurst(duration,volume,filterType,frequency,x=0){
    if(!soundEnabled)return;
    createSound();
    if(!audioContext || !masterGain)return;
    const length=Math.max(64,Math.floor(audioContext.sampleRate*duration));
    const buffer=audioContext.createBuffer(1,length,audioContext.sampleRate);
    const data=buffer.getChannelData(0);
    let low=0;
    for(let i=0;i<length;i++){
      const raw=Math.random()*2-1;
      low=low*.67+raw*.33;
      const envelope=Math.pow(1-i/length,2.4);
      data[i]=(filterType==='soft'?low:raw)*envelope;
    }
    const source=audioContext.createBufferSource();
    const filter=audioContext.createBiquadFilter();
    const gain=audioContext.createGain();
    source.buffer=buffer;
    filter.type=filterType==='soft'?'lowpass':filterType==='crack'?'highpass':'bandpass';
    filter.frequency.value=frequency||3000;
    filter.Q.value=filterType==='crack'? .75: .55;
    gain.gain.setValueAtTime(volume,audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+duration);
    source.connect(filter);filter.connect(gain);
    const panner=audioContext.createStereoPanner?audioContext.createStereoPanner():null;
    if(panner){panner.pan.value=clamp(x/(sideX||1),-1,1)*.65;gain.connect(panner);panner.connect(masterGain);}else gain.connect(masterGain);
    source.start();
    source.stop(audioContext.currentTime+duration+.02);
  }

  function iceClink(speed,x){
    const intensity=clamp((speed-1.1)/8,.06,.8);
    voice(random(1450,1850),.16,'sine',.055*intensity,'down',x,random(-5,5));
    voice(random(2200,2750),.11,'sine',.034*intensity,'down',x,random(-8,8));
    voice(random(3000,3700),.075,'triangle',.018*intensity,'down',x);
    voice(random(410,620),.095,'triangle',.028*intensity,'down',x);
    noiseBurst(random(.035,.065),.013*intensity,'crack',random(2500,4800),x);
    if(speed>4.5 && Math.random()<.6)noiseBurst(.07,.014*intensity,'crack',random(3200,5800),x);
  }

  function playImpact(kind,speed,x=0){
    if(!soundEnabled || speed<.9)return;
    const t=performance.now();
    if(t-soundClock<32)return;
    soundClock=t;
    const power=clamp((speed-.65)/8,.05,1);
    if(kind==='ice'){
      iceClink(speed,x);
    }else if(kind==='rubber'){
      voice(random(155,225),.13,'sine',.1*power,'down',x);
      voice(random(320,430),.07,'triangle',.025*power,'down',x);
      noiseBurst(.025,.012*power,'soft',650,x);
    }else if(kind==='tnt'){
      voice(115,.22,'sine',.12*power,'down',x);
      noiseBurst(.04,.04*power,'crack',1800,x);
    }else if(kind==='water'){
      noiseBurst(.055,.018*power,'soft',1450,x);
      voice(random(520,880),.095,'sine',.022*power,'down',x);
      voice(random(1050,1500),.045,'triangle',.009*power,'down',x);
    }else{
      voice(random(260,390),.075,'triangle',.08*power,'down',x);
      voice(random(480,720),.035,'sine',.025*power,'down',x);
      noiseBurst(.018,.012*power,'crack',2300,x);
    }
  }

  function onCollision(item,event){
    const other=bodies.get(event.body);
    let impact=0;
    try{impact=Math.abs(event.contact.getImpactVelocityAlongNormal());}catch(_){
      const a=item.body.velocity;
      const b=event.body?.velocity||{x:0,y:0,z:0};
      impact=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
    }
    if(!other){
      if(impact>1.15){
        playImpact(item.kind,impact,item.body.position.x);
        if(liquidMode && item.body.position.y-item.radius < liquidLevel+item.radius*.65){
          addWaveImpulse(item.body.position.x,item.body.position.z,clamp(impact*.018,.025,.17));
        }
        const p=item.body.position;
        const av=item.body.angularVelocity;
        const nearX=Math.abs(p.x)>sideX-item.radius*1.5;
        const nearY=p.y<floorY+item.radius*1.5||p.y>ceilY-item.radius*1.5;
        const nearZ=Math.abs(p.z)>.52;
        if(nearX){av.y*=.48;av.z*=.42;}
        if(nearY){av.x*=.42;av.z*=.44;}
        if(nearZ){av.x*=.62;av.y*=.62;}
      }
      return;
    }
    if(other===item)return;
    const minId=Math.min(item.id,other.id), maxId=Math.max(item.id,other.id);
    const key=minId+':'+maxId;
    const now=performance.now();
    const last=collisionTimes.get(key)||0;
    if(now-last<62)return;
    if(impact<1.05)return;
    collisionTimes.set(key,now);
    if(collisionTimes.size>180&&now-lastCollisionSweep>900){
      lastCollisionSweep=now;
      for(const [k,v] of collisionTimes)if(now-v>900)collisionTimes.delete(k);
    }
    if(liquidMode && item.body.position.y-item.radius < liquidLevel+item.radius*.65){
      addWaveImpulse(item.body.position.x,item.body.position.z,clamp(impact*.018,.025,.17));
    }
    const soundKind=item.kind==='ice'||other.kind==='ice'?'ice':
      item.kind==='rubber'&&other.kind==='rubber'?'rubber':
      item.kind==='tnt'||other.kind==='tnt'?'tnt':'cube';
    playImpact(soundKind,impact,(item.body.position.x+other.body.position.x)*.5);
  }

  function addWallImpact(kind,speed,x){
    if(speed>2)playImpact(kind,speed,x);
  }

  function createBodyItem(kind,x,y,z,options={}){
    const position={x:clamp(x,-sideX+.34,sideX-.34),y:clamp(y,floorY+.45,ceilY-.42),z:clamp(z,-.4,.4)};
    const item=addItem(kind,position,{x:random(-1.5,1.5),y:random(-.5,1.2),z:random(-.9,.9)},options);
    return item;
  }

  function scatter(kind,count){
    createSound();
    const centerY=clamp(.3,floorY+.6,ceilY-.6);
    const spawnX=random(-.5,.5);
    for(let i=0;i<count;i++){
      const x=spawnX+random(-.75,.75);
      const y=Math.min(ceilY-.5,centerY+random(.15,1.5));
      const z=random(-.32,.32);
      const fuseAt=kind==='tnt'?performance.now()+random(3200,4600):0;
      const item=createBodyItem(kind,x,y,z,{fuseAt});
      if(item&&kind==='tnt')item.body.velocity.set(random(-1.2,1.2),random(.1,1.1),random(-.9,.9));
    }
    status(kind==='ice'?'Лёд: прислушайся к звону и потрескиванию':kind==='tnt'?'TNT добавлен':'Предметы добавлены — хватай и бросай');
  }

  function resetScene(){
    for(const item of [...items])removeItem(item);
    clearEffects();
    for(let i=0;i<6;i++)createBodyItem('rubber',random(-sideX*.65,sideX*.65),random(.35,1.9),random(-.25,.25));
    for(let i=0;i<3;i++)createBodyItem('ice',random(-sideX*.65,sideX*.65),random(.6,2.2),random(-.22,.22));
    for(let i=0;i<3;i++)createBodyItem('cube',random(-sideX*.65,sideX*.65),random(.5,2.0),random(-.3,.3));
    status('Сцена готова — перетаскивай предметы');
  }

  function clearEffects(){
    for(const effect of activeEffects){
      scene.remove(effect.mesh);
      if(effect.mesh.geometry!==geometries.ring)effect.mesh.geometry.dispose();
      if(effect.mesh.material!==materials.ring)effect.mesh.material.dispose();
    }
    activeEffects.length=0;
  }

  function clearLiquidVisuals(){
    liquidWaveImpulses.length=0;
    liquidEnergy=0;
    liquidPouring=false;
    if(liquidVolumeMesh)liquidVolumeMesh.visible=false;
    if(liquidSurfaceMesh)liquidSurfaceMesh.visible=false;
    if(liquidPourMesh)liquidPourMesh.visible=false;
  }

  function updateLiquidLayout(){
    if(!liquidVolumeMesh||!liquidSurfaceMesh||!liquidPourMesh)return;
    const width=Math.max(.2,sideX*2-.16);
    const depth=1.34;
    const height=Math.max(.035,liquidLevel-floorY);
    liquidVolumeMesh.scale.set(width,height,depth);
    liquidVolumeMesh.position.set(0,floorY+height*.5,0);
    liquidSurfaceMesh.scale.set(width,1,depth);
    liquidSurfaceMesh.position.set(0,liquidLevel,0);
    const streamHeight=Math.max(.03,ceilY-liquidLevel);
    liquidPourMesh.scale.set(1,streamHeight,1);
    liquidPourMesh.position.set(0,liquidLevel+streamHeight*.5,.12);
    const shown=Boolean(liquidMode);
    liquidVolumeMesh.visible=shown;
    liquidSurfaceMesh.visible=shown;
    liquidPourMesh.visible=shown&&liquidPouring;
  }

  function addWaveImpulse(x,z,amplitude){
    if(!liquidMode)return;
    if(liquidWaveImpulses.length>=MAX_LIQUID_WAVES)liquidWaveImpulses.shift();
    liquidWaveImpulses.push({
      x,z,amplitude:clamp(amplitude,.018,.22),
      born:performance.now()/1000,
      speed:liquidMode==='water'?2.25:1.05,
      decay:liquidMode==='water'?1.85:1.1
    });
    liquidEnergy=Math.min(1.6,liquidEnergy+amplitude*2.8);
  }

  function setLiquidMode(mode){
    if(liquidMode===mode){
      liquidMode=null;
      clearLiquidVisuals();
      stopLiquidSound();
      for(const button of document.querySelectorAll('[data-liquid]')){
        button.setAttribute('aria-pressed','false');
      }
      status('Жидкость убрана');
      return;
    }
    clearLiquidVisuals();
    liquidMode=mode;
    liquidLevel=floorY+.045;
    liquidTargetLevel=floorY+(ceilY-floorY)*(mode==='water'?.76:.62);
    liquidPouring=true;
    nextPourWaveAt=performance.now()+180;
    liquidVolumeMesh.material=mode==='water'?materials.waterVolume:materials.slimeVolume;
    liquidSurfaceMesh.material=mode==='water'?materials.waterSurface:materials.slimeSurface;
    liquidPourMesh.material=mode==='water'?materials.waterStream:materials.slimeStream;
    liquidVolumeMesh.visible=true;
    liquidSurfaceMesh.visible=true;
    liquidPourMesh.visible=true;
    for(const button of document.querySelectorAll('[data-liquid]')){
      button.setAttribute('aria-pressed',String(button.dataset.liquid===mode));
    }
    addWaveImpulse(0,.12,mode==='water'?.18:.11);
    startLiquidSound(mode);
    updateLiquidLayout();
    status(mode==='water'?'Вода льётся — поверхность колышется и поднимается':'Слизь медленно наполняет телефон густой волной');
  }

  function applyLiquidForces(dt){
    if(!liquidMode)return;
    const water=liquidMode==='water';
    for(const item of items){
      const pos=item.body.position;
      const r=item.radius;
      const submerged=clamp((liquidLevel-(pos.y-r))/(2*r),0,1);
      const previous=item.liquidSubmerged||0;
      item.liquidSubmerged=submerged;
      if(submerged>.05){
        const factor=water?1.08:1.17;
        item.body.force.x+=-gravityX*item.mass*submerged*factor;
        item.body.force.y+=-gravityY*item.mass*submerged*factor;
        item.body.force.z+=-gravityZ*item.mass*submerged*factor;
        const drag=(water?1.1:3.4)*submerged*dt;
        const damp=clamp(1-drag,.65,1);
        item.body.velocity.x*=damp;
        item.body.velocity.y*=damp;
        item.body.velocity.z*=damp;
        item.body.angularVelocity.x*=clamp(1-(water?1.1:3)*submerged*dt,.68,1);
        item.body.angularVelocity.y*=clamp(1-(water?1.1:3)*submerged*dt,.68,1);
        item.body.angularVelocity.z*=clamp(1-(water?1.2:3.2)*submerged*dt,.66,1);
      }
      if(submerged>.12&&previous<=.12&&pos.y+r>liquidLevel-.12){
        addWaveImpulse(pos.x,pos.z,clamp(Math.hypot(item.body.velocity.x,item.body.velocity.y)*.025,.035,.16));
        playImpact('water',Math.hypot(item.body.velocity.x,item.body.velocity.y),pos.x);
      }
    }
  }

  function updateLiquids(dt){
    if(!liquidMode)return;
    const step=Math.min(dt,.035);
    const nowSeconds=performance.now()/1000;
    if(liquidPouring){
      const fillSpeed=liquidMode==='water'?.72:.34;
      liquidLevel=Math.min(liquidTargetLevel,liquidLevel+fillSpeed*step);
      if(performance.now()>=nextPourWaveAt){
        addWaveImpulse(random(-sideX*.32,sideX*.32),random(-.38,.38),liquidMode==='water'?.12:.055);
        nextPourWaveAt=performance.now()+(liquidMode==='water'?560:1050);
        if(soundEnabled&&liquidMode==='water'){
          noiseBurst(.045,.007,'soft',1550,0);
          voice(random(780,1150),.065,'sine',.009,'down',0);
        }
      }
      if(liquidLevel>=liquidTargetLevel-.005){
        liquidPouring=false;
        if(liquidPourMesh)liquidPourMesh.visible=false;
        status(liquidMode==='water'?'Аквариум наполнен — волны продолжают двигаться':'Слизь собралась в бассейн и медленно колышется');
      }
    }
    liquidEnergy*=Math.exp(-step*(liquidMode==='water'?1.5:.9));
    updateLiquidLayout();

    liquidSurfaceAccumulator+=step;
    if(liquidSurfaceAccumulator<1/30)return;
    liquidSurfaceAccumulator=0;
    const geometry=geometries.liquidSurface;
    const position=geometry.attributes.position;
    const width=Math.max(.2,sideX*2-.16);
    const depth=1.34;
    const baseAmp=liquidMode==='water'?.027:.012;
    const energyAmp=Math.min(liquidEnergy,1.5)*(liquidMode==='water'?.035:.019);
    for(let i=0;i<position.count;i++){
      const localX=position.getX(i);
      const localZ=position.getZ(i);
      const x=localX*width;
      const z=localZ*depth;
      let wave=Math.sin(x*4.1+nowSeconds*2.35)*baseAmp;
      wave+=Math.sin(z*7.4-nowSeconds*1.65)*baseAmp*.48;
      wave+=Math.sin((x*.8+z)*5.2+nowSeconds*1.15)*baseAmp*.27;
      wave+=Math.sin((x-z*.45)*9.8-nowSeconds*2.1)*energyAmp*.28;
      for(const impulse of liquidWaveImpulses){
        const age=nowSeconds-impulse.born;
        if(age<0||age>2.8)continue;
        const distance=Math.hypot(x-impulse.x,z-impulse.z);
        const front=distance-age*impulse.speed;
        const envelope=Math.exp(-Math.abs(front)*2.6)*Math.exp(-age*impulse.decay);
        wave+=Math.sin(front*13)*impulse.amplitude*envelope;
      }
      position.setY(i,wave);
    }
    position.needsUpdate=true;
    geometry.computeVertexNormals();
    for(let i=liquidWaveImpulses.length-1;i>=0;i--){
      if(nowSeconds-liquidWaveImpulses[i].born>2.8)liquidWaveImpulses.splice(i,1);
    }
  }

  function createExplosion(item){
    if(!item || !items.includes(item))return;
    const center=itemCenter(item);
    for(const other of items){
      if(other===item)continue;
      const p=other.body.position;
      const dx=p.x-center.x,dy=p.y-center.y,dz=p.z-center.z;
      const distance=Math.max(.05,Math.hypot(dx,dy,dz));
      const radius=3.35;
      if(distance>radius)continue;
      const factor=1-distance/radius;
      const impulse=new CANNON.Vec3(dx/distance*(4+factor*11),dy/distance*(4+factor*12)+factor*2,dz/distance*(3+factor*7));
      other.body.wakeUp();
      other.body.applyImpulse(impulse,other.body.position);
      other.body.angularVelocity.x+=random(-4,4)*factor;
      other.body.angularVelocity.y+=random(-4,4)*factor;
      other.body.angularVelocity.z+=random(-5,5)*factor;
    }
    const ring=new THREE.Mesh(geometries.ring,materials.ring);
    ring.position.copy(center);
    ring.lookAt(camera.position);
    ring.scale.setScalar(.1);
    scene.add(ring);
    activeEffects.push({mesh:ring,life:.65,maxLife:.65,type:'ring',x:center.x});
    noiseBurst(.23,.25,'soft',450,center.x);
    voice(82,.55,'sine',.25,'down',center.x);
    voice(170,.23,'sawtooth',.08,'down',center.x);
    noiseBurst(.065,.13,'crack',1300,center.x);
    for(let i=0;i<4;i++)voice(random(700,1250),random(.04,.1),'triangle',random(.025,.05),'down',center.x);
    removeItem(item);
    status('Ударная волна разбрасывает предметы');
  }

  function updateEffects(dt){
    for(let i=activeEffects.length-1;i>=0;i--){
      const fx=activeEffects[i];
      fx.life-=dt;
      if(fx.type==='ring'){
        const progress=1-clamp(fx.life/fx.maxLife,0,1);
        fx.mesh.scale.setScalar(.1+progress*5.4);
        fx.mesh.material=materials.ring;
        fx.mesh.material.opacity=(1-progress)*.82;
      }
      if(fx.life<=0){
        scene.remove(fx.mesh);
        activeEffects.splice(i,1);
      }
    }
  }

  function boundsFor(item){
    const pos=item.body.position;
    const radius=item.radius*.88;
    const av=item.body.angularVelocity;
    if(pos.x<-sideX+radius){pos.x=-sideX+radius;if(item.body.velocity.x<0){addWallImpact(item.kind,Math.abs(item.body.velocity.x),pos.x);item.body.velocity.x=Math.abs(item.body.velocity.x)*.78;av.y*=.48;av.z*=.42;}}
    if(pos.x>sideX-radius){pos.x=sideX-radius;if(item.body.velocity.x>0){addWallImpact(item.kind,Math.abs(item.body.velocity.x),pos.x);item.body.velocity.x=-Math.abs(item.body.velocity.x)*.78;av.y*=.48;av.z*=.42;}}
    const rY=item.kind==='rubber'?radius:radius*1.18;
    if(pos.y<floorY+rY){
      pos.y=floorY+rY;
      if(item.body.velocity.y<-.25){addWallImpact(item.kind,Math.abs(item.body.velocity.y),pos.x);item.body.velocity.y=Math.abs(item.body.velocity.y)*(item.kind==='rubber'?.86:.67);av.x*=.42;av.z*=.44;}
      else if(Math.abs(item.body.velocity.y)<.4)item.body.velocity.y=0;
      if(Math.abs(item.body.velocity.y)<.18&&Math.abs(av.x)+Math.abs(av.z)<.45){av.x*=.82;av.z*=.82;}
    }
    if(pos.y>ceilY-rY){pos.y=ceilY-rY;if(item.body.velocity.y>0){addWallImpact(item.kind,Math.abs(item.body.velocity.y),pos.x);item.body.velocity.y=-Math.abs(item.body.velocity.y)*.68;av.x*=.58;av.z*=.58;}}
    if(pos.z<-.72){pos.z=-.72;if(item.body.velocity.z<0){item.body.velocity.z=Math.abs(item.body.velocity.z)*.68;av.x*=.62;av.y*=.62;}}
    if(pos.z>.72){pos.z=.72;if(item.body.velocity.z>0){item.body.velocity.z=-Math.abs(item.body.velocity.z)*.68;av.x*=.62;av.y*=.62;}}
    const touchingX=Math.abs(pos.x)>=sideX-radius-.025;
    const touchingY=pos.y<=floorY+rY+.025||pos.y>=ceilY-rY-.025;
    const touchingZ=Math.abs(pos.z)>=.68;
    if(touchingX){av.y*=.9;av.z*=.9;}
    if(touchingY){av.x*=.9;av.z*=.9;}
    if(touchingZ){av.x*=.9;av.y*=.9;}
    const speed=Math.hypot(item.body.velocity.x,item.body.velocity.y,item.body.velocity.z);
    const spin=Math.hypot(av.x,av.y,av.z);
    if(touchingY&&speed<.22&&spin<2.5){av.x*=.68;av.y*=.82;av.z*=.68;}
    if((touchingX||touchingY||touchingZ)&&speed<.12&&spin<.16)item.body.sleep();
    const maxSpin=9;
    av.x=clamp(av.x,-maxSpin,maxSpin);av.y=clamp(av.y,-maxSpin,maxSpin);av.z=clamp(av.z,-maxSpin,maxSpin);
  }

  const raycaster=new THREE.Raycaster();
  const ndc=new THREE.Vector2();
  const dragPlane=new THREE.Plane(new THREE.Vector3(0,0,1),0);
  const hitPoint=new THREE.Vector3();
  const worldPoint=new THREE.Vector3();

  function screenCoordinates(event){
    const rect=canvas.getBoundingClientRect();
    ndc.x=((event.clientX-rect.left)/rect.width)*2-1;
    ndc.y=-((event.clientY-rect.top)/rect.height)*2+1;
  }

  function pointerWorld(event,z=0){
    screenCoordinates(event);
    raycaster.setFromCamera(ndc,camera);
    dragPlane.constant=-z;
    raycaster.ray.intersectPlane(dragPlane,worldPoint);
    return worldPoint.clone();
  }

  function pointerDown(event){
    if(event.button!==undefined&&event.button!==0)return;
    event.preventDefault();
    createSound();
    const rect=canvas.getBoundingClientRect();
    screenCoordinates(event);
    raycaster.setFromCamera(ndc,camera);
    const hits=raycaster.intersectObjects(items.map(item=>item.mesh),false);
    if(!hits.length)return;
    let mesh=hits[0].object;
    while(mesh.parent && !items.some(i=>i.mesh===mesh))mesh=mesh.parent;
    const item=items.find(i=>i.mesh===mesh);
    if(!item)return;
    if(paintMode){
      if(item.material?.color)item.material.color.set(selectedPaintColor);
      item.body.wakeUp();
      status('Цвет предмета изменён');
      return;
    }
    item.body.wakeUp();
    const p=pointerWorld(event,item.body.position.z);
    dragging={
      item,pointerId:event.pointerId,planeZ:item.body.position.z,
      offset:new THREE.Vector3(item.body.position.x-p.x,item.body.position.y-p.y,0),
      start:p.clone(),startTime:performance.now(),moved:false,
      samples:[{x:p.x,y:p.y,t:performance.now()}],oldType:item.body.type
    };
    item.body.type=CANNON.Body.KINEMATIC;
    item.body.updateMassProperties();
    item.body.velocity.set(0,0,0);
    item.body.angularVelocity.set(0,0,0);
    canvas.setPointerCapture?.(event.pointerId);
    status(item.kind==='ice'?'Лёд в руке — отпусти, чтобы услышать звон':'Оттяни и отпусти — предмет получит импульс');
  }

  function pointerMove(event){
    if(!dragging||event.pointerId!==dragging.pointerId)return;
    event.preventDefault();
    const d=dragging, item=d.item;
    const p=pointerWorld(event,d.planeZ).add(d.offset);
    if(p.distanceTo(d.start)>.09)d.moved=true;
    const pos=item.body.position;
    pos.x=clamp(p.x,-sideX+.31,sideX-.31);
    pos.y=clamp(p.y,floorY+.35,ceilY-.35);
    pos.z=d.planeZ;
    item.body.aabbNeedsUpdate=true;
    item.body.wakeUp();
    const t=performance.now();
    d.samples.push({x:pos.x,y:pos.y,t});
    while(d.samples.length>2&&d.samples[0].t<t-115)d.samples.shift();
  }

  function pointerUp(event){
    if(!dragging|| (event&&event.pointerId!==undefined&&event.pointerId!==dragging.pointerId))return;
    const d=dragging,item=d.item;
    const elapsed=performance.now()-d.startTime;
    const samples=d.samples;
    if(item.kind==='tnt'&&!d.moved&&elapsed<700){
      dragging=null;
      createExplosion(item);
      return;
    }
    item.body.type=CANNON.Body.DYNAMIC;
    item.body.mass=item.mass;
    item.body.updateMassProperties();
    if(d.moved&&samples.length>1){
      const a=samples[0],b=samples[samples.length-1];
      const seconds=Math.max(.028,(b.t-a.t)/1000);
      item.body.velocity.set(
        clamp((b.x-a.x)/seconds,-12,12),
        clamp((b.y-a.y)/seconds,-12,12),
        clamp((b.x-a.x)/seconds*.11,-4.5,4.5)
      );
      const offset=d.offset;
      const spin=clamp(((b.x-a.x)*offset.y-(b.y-a.y)*offset.x)*1.6,-8,8);
      item.body.angularVelocity.set(clamp(item.body.velocity.z*1.1,-2.5,2.5),clamp(-item.body.velocity.z*.8,-2,2),spin);
      item.body.wakeUp();
      playImpact(item.kind,Math.hypot(item.body.velocity.x,item.body.velocity.y),item.body.position.x);
      if(item.kind==='tnt')item.fuseAt=performance.now()+1800;
    }
    dragging=null;
    status(item.kind==='tnt'&&item.fuseAt?'Фитиль горит…':'Тяни предмет, бросай и слушай');
  }

  function resize(){
    if(!renderer||!screen)return;
    const oldRange=Math.max(.1,ceilY-floorY);
    const liquidRatio=liquidMode?clamp((liquidLevel-floorY)/oldRange,0,1):0;
    const targetRatio=liquidMode?clamp((liquidTargetLevel-floorY)/oldRange,0,1):0;
    const width=Math.max(1,screen.clientWidth),height=Math.max(1,screen.clientHeight);
    const dpr=Math.min(window.devicePixelRatio||1,maxDpr)*fpsScale;
    renderer.setPixelRatio(Math.max(.7,dpr));
    renderer.setSize(width,height,false);
    camera.aspect=width/height;
    camera.updateProjectionMatrix();
    viewHalfHeight=camera.position.z*Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    viewHalfWidth=viewHalfHeight*camera.aspect;
    rebuildWalls();
    if(liquidMode){
      liquidLevel=floorY+liquidRatio*(ceilY-floorY);
      liquidTargetLevel=floorY+targetRatio*(ceilY-floorY);
      updateLiquidLayout();
    }
    for(const item of items){
      const p=item.body.position;
      p.x=clamp(p.x,-sideX+.32,sideX-.32);
      p.y=clamp(p.y,floorY+.34,ceilY-.34);
      item.body.aabbNeedsUpdate=true;
    }
  }

  function syncObjects(){
    for(const item of items){
      const p=item.body.position,q=item.body.quaternion;
      item.mesh.position.set(p.x,p.y,p.z);
      item.mesh.quaternion.set(q.x,q.y,q.z,q.w);
      const heightAboveFloor=clamp((p.y-floorY)/Math.max(.1,ceilY-floorY),0,1);
      item.shadow.position.set(p.x,floorY+.009,p.z-.03);
      const scale=clamp(1.12-heightAboveFloor*.56,.48,1.12);
      item.shadow.scale.set(scale,scale,1);
      item.shadow.material=materials.shadow;
      item.shadow.material.opacity=clamp(.68-heightAboveFloor*.34,.1,.68);
    }
  }

  function updateTilt(event){
    if(!tiltEnabled||!Number.isFinite(event.beta)||!Number.isFinite(event.gamma))return;
    const beta=THREE.MathUtils.degToRad(event.beta);
    const gamma=THREE.MathUtils.degToRad(event.gamma);
    const rawAngle=(window.screen&&window.screen.orientation&&Number.isFinite(window.screen.orientation.angle)
      ?window.screen.orientation.angle
      :(Number.isFinite(window.orientation)?window.orientation:0));
    const screenAngle=THREE.MathUtils.degToRad(rawAngle);
    const g=12;
    // Convert absolute sensor orientation to gravity projected onto the visible screen plane.
    // Do not calibrate against the activation pose: doing so cancels most of the Y-axis signal.
    const sensorX=Math.sin(gamma)*g;
    const sensorY=-Math.sin(beta)*Math.cos(gamma)*g;
    let gx=sensorX*Math.cos(screenAngle)+sensorY*Math.sin(screenAngle);
    let gy=-sensorX*Math.sin(screenAngle)+sensorY*Math.cos(screenAngle);
    const length=Math.hypot(gx,gy);
    if(length>g){gx*=g/length;gy*=g/length;}
    targetGravityX=clamp(gx,-g,g);
    targetGravityY=clamp(gy,-g,g);
    gravityZ=0;
  }

  async function toggleTilt(){
    if(tiltEnabled){
      tiltEnabled=false;tiltReference=null;
      window.removeEventListener('deviceorientation',updateTilt,true);
      gravityX=0;gravityY=-12;gravityZ=0;
      targetGravityX=0;targetGravityY=-12;
      lastWakeGravity={x:0,y:-12,z:0};
      world.gravity.set(gravityX,gravityY,gravityZ);
      tiltButton.setAttribute('aria-pressed','false');tiltLabel.textContent='Наклон';
      status('Управление наклоном выключено');
      return;
    }
    if(!('DeviceOrientationEvent'in window)){status('Датчик наклона недоступен');return;}
    try{
      if(typeof DeviceOrientationEvent.requestPermission==='function'){
            const result=await DeviceOrientationEvent.requestPermission();
        if(result!=='granted'){status('Разреши доступ к датчику в браузере');return;}
      }
      tiltEnabled=true;tiltReference=null;
      gravityX=0;gravityY=-12;gravityZ=0;
      lastWakeGravity={x:0,y:-12,z:0};
      world.gravity.set(gravityX,gravityY,gravityZ);
      window.addEventListener('deviceorientation',updateTilt,true);
      tiltButton.setAttribute('aria-pressed','true');tiltLabel.textContent='Наклон включён';
      status('Наклоняй телефон — гравитация меняется');
    }catch(_){status('Не удалось включить датчик наклона');}
  }

  function bindUI(){
    canvas.addEventListener('pointerdown',pointerDown,{passive:false});
    canvas.addEventListener('pointermove',pointerMove,{passive:false});
    canvas.addEventListener('pointerup',pointerUp);
    canvas.addEventListener('pointercancel',pointerUp);
    canvas.addEventListener('lostpointercapture',()=>{if(dragging)pointerUp();});
    window.addEventListener('resize',resize,{passive:true});
    window.addEventListener('orientationchange',()=>{
      if(tiltEnabled)tiltReference=null;
      setTimeout(resize,120);
    },{passive:true});
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){
        lastRender=0;
        clock.stop();
        stopLiquidSound();
        if(animationHandle)cancelAnimationFrame(animationHandle);
        animationHandle=0;
      }else{
        clock.start();
        lastRender=0;
        if(liquidMode&&soundEnabled)startLiquidSound(liquidMode);
        if(!animationHandle)animationHandle=requestAnimationFrame(animate);
      }
    });
    document.querySelectorAll('[data-phone-add]').forEach(button=>button.addEventListener('click',()=>{
      const kind=button.dataset.phoneAdd;
      scatter(kind,kind==='rubber'?5:kind==='ice'?3:kind==='cube'?4:1);
    }));
    document.getElementById('phoneClear').addEventListener('click',()=>{
      for(let i=items.length-1;i>=0;i--)removeItem(items[i]);
      clearEffects();
      status('Экран очищен');
    });
    document.getElementById('phoneReset').addEventListener('click',resetScene);
    const paintColor=document.getElementById('phonePaintColor');
    const paintButton=document.getElementById('phonePaintMode');
    if(paintColor)paintColor.addEventListener('input',()=>{selectedPaintColor=paintColor.value;});
    if(paintButton)paintButton.addEventListener('click',()=>{
      paintMode=!paintMode;
      paintButton.setAttribute('aria-pressed',String(paintMode));
      paintButton.textContent=paintMode?'✦ Кисть: включена':'✦ Кисть: выкл.';
      canvas.style.cursor=paintMode?'crosshair':'grab';
      status(paintMode?'Нажимай на предметы, чтобы перекрасить':'Кисть выключена');
    });
    document.querySelectorAll('[data-liquid]').forEach(button=>button.addEventListener('click',()=>setLiquidMode(button.dataset.liquid)));
    soundButton.addEventListener('click',()=>{
      soundEnabled=!soundEnabled;
      soundButton.setAttribute('aria-pressed',String(soundEnabled));
      soundLabel.textContent=soundEnabled?'Звук':'Без звука';
      if(soundEnabled){
        createSound();
        if(masterGain&&audioContext)masterGain.gain.setTargetAtTime(.48,audioContext.currentTime,.04);
        if(liquidMode)startLiquidSound(liquidMode);
      }else{
        stopLiquidSound();
        if(masterGain&&audioContext)masterGain.gain.setTargetAtTime(.0001,audioContext.currentTime,.025);
      }
      status(soundEnabled?'Звуки включены':'Звуки выключены');
    });
    tiltButton.addEventListener('click',toggleTilt);
  }

  function animate(){
    if(document.hidden||!renderer||!world){animationHandle=0;return;}
    animationHandle=requestAnimationFrame(animate);
    const frameNow=performance.now();
    let delta=clock.getDelta();
    if(!delta||delta<0)delta=1/60;
    delta=Math.min(delta,MAX_FRAME_DELTA);
    fpsElapsed+=delta;fpsSamples++;
    if(fpsElapsed>.9){
      const fps=fpsSamples/fpsElapsed;
      fpsElapsed=0;fpsSamples=0;
      if(fps<42&&maxDpr>.85){
        maxDpr=Math.max(.85,maxDpr-.1);
        fpsScale=Math.max(.72,fpsScale-.07);
        resize();
      }else if(fps>56&&maxDpr<(coarsePointer?1.25:1.5)){
        maxDpr=Math.min(coarsePointer?1.25:1.5,maxDpr+.05);
        fpsScale=Math.min(1,fpsScale+.035);
        resize();
      }
    }
    const gravityBlend=1-Math.exp(-delta*10);
    gravityX+= (targetGravityX-gravityX)*gravityBlend;
    gravityY+= (targetGravityY-gravityY)*gravityBlend;
    world.gravity.set(gravityX,gravityY,gravityZ);
    const gravityChange=Math.hypot(gravityX-lastWakeGravity.x,gravityY-lastWakeGravity.y);
    if(tiltEnabled&&gravityChange>.8&&frameNow-lastWakeAt>120){
      lastWakeGravity={x:gravityX,y:gravityY,z:0};
      lastWakeAt=frameNow;
      for(const item of items)item.body.wakeUp();
    }
    if(dragging){
      dragging.item.body.type=CANNON.Body.KINEMATIC;
      dragging.item.body.updateMassProperties();
    }
    applyLiquidForces(delta);
    world.step(FIXED_STEP,delta,8);
    for(let i=items.length-1;i>=0;i--){
      const item=items[i];
      boundsFor(item);
      if(item.fuseAt&&performance.now()>item.fuseAt)createExplosion(item);
    }
    syncObjects();
    updateEffects(Math.min(delta,.034));
    updateLiquids(Math.min(delta,.034));
    renderer.render(scene,camera);
    lastRender=frameNow;
  }

  async function init(){
    try{
      createRenderer();
      createMaterials();
      createScene();
      createPhysics();
      resize();
      bindUI();
      resetScene();
      if(renderMode)renderMode.textContent='3D PHYSICS · 120 HZ';
      status('3D-сцена готова');
      animationHandle=requestAnimationFrame(animate);
    }catch(error){
      console.error('RGB Phone failed to initialise',error);
      status('Не удалось запустить 3D. Обнови страницу или проверь соединение.');
      if(renderMode)renderMode.textContent='ОШИБКА ЗАПУСКА';
    }
  }

  init();
})();