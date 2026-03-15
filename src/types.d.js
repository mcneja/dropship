// @ts-check

/**
 * @typedef {[number, number]} Vec2
 * @typedef {{x:number,y:number}} Point
 */

/**
 * @typedef {{x:number,y:number,tri?:Array<{x:number,y:number,air:number}>|null,contacts?:Array<{x:number,y:number,nx:number,ny:number,av?:number}>|null}} CollisionHit
 */

/**
 * @typedef {Object} CollisionQuery
 * @property {(x:number,y:number)=>number} airValueAtWorld
 * @property {(x:number,y:number)=>number} planetAirValueAtWorld
 * @property {(x:number,y:number)=>{x:number,y:number}} gravityAt
 * @property {(x:number,y:number)=>{air:number, source:"mothership"|"planet"}} sampleAtWorld
 * @property {(points:Array<[number, number]>)=>boolean} collidesAtPoints
 * @property {(points:Array<[number, number]>)=>{samples:Array<[number, number, boolean, number]>, hit:CollisionHit|null, hitSource:"mothership"|"planet"|null}} sampleCollisionPoints
 */

/**
 * @typedef {Object} MapWorld
 * @property {number} seed
 * @property {Uint8Array<ArrayBufferLike>} air
 * @property {Vec2[]} entrances
 * @property {number} finalAir
 */

/**
 * @typedef {{updateHud:(hud:HTMLElement, stats:{fps:number,state:string,speed:number,verts:number,air:number,miners:number,minersDead:number,level:number,debug:boolean,minerCandidates:number,shipHp:number,bombs:number,landingDebug?:{source?:string,reason?:string,dotUp?:number,slope?:number,landSlope?:number,vn?:number,vt?:number,speed?:number,airFront?:number,airBack?:number,landable?:boolean,landed?:boolean,contactsCount?:number,bestDotUpAny?:number,bestDotUpUnder?:number,impactPoint?:number,supportPoint?:number,impactT?:number,supportT?:number,impactX?:number,impactY?:number,supportX?:number,supportY?:number,supportTriOuterCount?:number,supportTriAirMin?:number,supportTriAirMax?:number,supportTriRMin?:number,supportTriRMax?:number,overlapBeforeCount?:number,overlapAfterCount?:number,overlapBeforeMin?:number,overlapAfterMin?:number,depenIter?:number,depenPush?:number,depenCushion?:number,depenDir?:number,depenCleared?:boolean,collisionDiag?:any}|null,inputType:("keyboard"|"mouse"|"touch"|"gamepad"|null|undefined)})=>void, updatePlanetLabel?:(el:HTMLElement, label:string)=>void, updateObjectiveLabel?:(el:HTMLElement, text:string)=>void, updateShipStatusLabel?:(el:HTMLElement, stats:{shipHp:number,shipHpMax:number,bombs:number,bombsMax:number})=>void, updateHeatMeter?:(el:HTMLElement, heat:number, show:boolean, flashing:boolean)=>void}} Ui
 */

/**
 * @typedef {Object} Ship
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {string} state
 * @property {number} explodeT
 * @property {number} lastAir
 * @property {number} hpCur
 * @property {number} bombsCur
 * @property {number} heat
 * @property {number} invertT
 * @property {number} hitCooldown
 * @property {number} cabinSide
 * @property {{path:Array<{x:number,y:number}>, indexClosest:number}|null} guidePath
 * @property {{lx:number,ly:number}|null} _dock
 * 
 * @property {number} dropshipMiners
 * @property {number} dropshipPilots
 * @property {number} dropshipEngineers
 * 
 * @property {number} mothershipMiners
 * @property {number} mothershipPilots
 * @property {number} mothershipEngineers
 * 
 * @property {number} hpMax
 * @property {number} bombsMax
 * @property {number} thrust
 * @property {number} gunPower
 * @property {boolean} rescueeDetector
 * @property {boolean} planetScanner
 * 
 * @property {Array<[number,number,boolean,number]>|null} [_samples]
 * @property {{x:number,y:number,source?:"planet"|"mothership",tri?:Array<{x:number,y:number,air?:number}>|null,node?:{x:number,y:number}|null,contacts?:Array<{x:number,y:number,nx:number,ny:number,av?:number}>|null}|null} [_collision]
 * @property {number} [_shipRadius]
 * @property {number} [_mothershipTrapFrames]
 * @property {{abs?:any,rel?:any}|null} [_lastMothershipCollisionDiag]
 * @property {{source?:string,reason?:string,dotUp?:number,slope?:number,landSlope?:number,vn?:number,vt?:number,speed?:number,airFront?:number,airBack?:number,landable?:boolean,landed?:boolean,support?:boolean,supportDist?:number,contactsCount?:number,bestDotUpAny?:number,bestDotUpUnder?:number,impactPoint?:number,supportPoint?:number,impactT?:number,supportT?:number,impactX?:number,impactY?:number,supportX?:number,supportY?:number,supportTriOuterCount?:number,supportTriAirMin?:number,supportTriAirMax?:number,supportTriRMin?:number,supportTriRMax?:number,overlapBeforeCount?:number,overlapAfterCount?:number,overlapBeforeMin?:number,overlapAfterMin?:number,depenIter?:number,depenPush?:number,depenCushion?:number,depenDir?:number,depenCleared?:boolean,collisionDiag?:any}|null} [_landingDebug]
 */

/**
 * @typedef {Object} MothershipPoint
 * @property {number} x
 * @property {number} y
 * @property {number} air
 */

// Mothership typedef removed (now a class in mothership.js).

/**
 * @typedef {Object} ViewState
 * @property {number} xCenter
 * @property {number} yCenter
 * @property {number} radius
 * @property {number} angle
 */

/**
 * @typedef {Object} Miner
 * @property {number} x
 * @property {number} y
 * @property {number} jumpCycle
 * @property {"miner"|"pilot"|"engineer"} type
 * @property {"idle"|"running"} state
 */

/**
 * @typedef {"hunter"|"ranger"|"crawler"|"turret"|"orbitingTurret"} EnemyType
 */

/**
 * @typedef {Object} Enemy
 * @property {EnemyType} type
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} cooldown
 * @property {number} hp
 * @property {number|null} iNodeGoal
 * @property {number} [hitT]
 */

/**
 * @typedef {Object} Shot
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} life
 * @property {EnemyType} owner
 */

/**
 * @typedef {Object} Explosion
 * @property {number} x
 * @property {number} y
 * @property {number} life
 * @property {EnemyType} owner
 * @property {number} radius
 */

/**
 * @typedef {Object} Debris
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} a
 * @property {number} w
 * @property {number} life
 */

/**
 * @typedef {Object} RenderState
 * @property {ViewState} view
 * @property {Ship} ship
 * @property {import("./mothership.js").Mothership} [mothership]
 * @property {Array<Debris>} debris
 * @property {InputState} input
 * @property {boolean} debugCollisions
 * @property {boolean} debugNodes
 * @property {boolean} debugPlanetTriangles
 * @property {boolean} debugCollisionContours
 * @property {boolean} [debugRingVertices]
 * @property {boolean} debugMinerGuidePath
 * @property {Array<{x:number,y:number}>|null} [debugMinerPathToMiner]
 * @property {boolean} fogEnabled
 * @property {Array<[number,number,boolean,number]>|null} [debugCollisionSamples]
 * @property {Array<[number,number,boolean,number]>|null} [debugPoints]
 * @property {number} fps
 * @property {number} finalAir
 * @property {Array<Miner>} miners
 * @property {number} minersRemaining
 * @property {number} level
 * @property {number} minersDead
 * @property {number} [minerTarget]
 * @property {Array<{x:number,y:number,type:EnemyType,vx?:number,vy?:number,cooldown?:number,hp?:number,hitT?:number,dir?:number,fuse?:number}>} enemies
 * @property {Array<{x:number,y:number,vx?:number,vy?:number,life?:number,owner:string}>} shots
 * @property {Array<{x:number,y:number,life:number,owner:string,radius?:number}>} explosions
 * @property {Array<{x:number,y:number,vx?:number,vy?:number,a:number,w?:number,life:number}>} enemyDebris
 * @property {Array<{x:number,y:number,vx?:number,vy?:number,life?:number}>} playerShots
 * @property {Array<{x:number,y:number,vx?:number,vy?:number,life?:number}>} playerBombs
 * @property {{lava:Array<{x:number,y:number,vx?:number,vy?:number,life?:number}>,mushroom:Array<{x:number,y:number,vx?:number,vy?:number,life?:number}>,bubbles:Array<{x:number,y:number,vx?:number,vy?:number,life?:number,maxLife?:number,size?:number,rot?:number,spin?:number}>,splashes:Array<{x:number,y:number,vx?:number,vy?:number,life?:number,maxLife?:number,size?:number,rot?:number,cr?:number,cg?:number,cb?:number}>}} featureParticles
 * @property {Array<{x:number,y:number,life:number,radius?:number}>} entityExplosions
 * @property {{x:number,y:number}|null} aimWorld
 * @property {{x:number,y:number}|null} [aimOrigin]
 * @property {{rockDark:[number,number,number],rockLight:[number,number,number],airDark:[number,number,number],airLight:[number,number,number],surfaceRockDark:[number,number,number],surfaceRockLight:[number,number,number],surfaceBand:number}|null|undefined} [planetPalette]
 * @property {{leftTouch:{x:number,y:number}|null,laserTouch:{x:number,y:number}|null,bombTouch:{x:number,y:number}|null}|null|undefined} touchUi
 * @property {boolean} [touchStart]
 * @property {"respawnShip"|"restartGame"|"upgrade"|"nextLevel"|"viewMap"|"exitMap"|null} [touchStartMode]
 * @property {boolean} [showGameplayIndicators]
 */

/**
 * @typedef {Object} InputState
 * @property {Point} stickThrust
 * @property {boolean} left
 * @property {boolean} right
 * @property {boolean} thrust
 * @property {boolean} down
 * @property {boolean} reset
 * @property {boolean} abandonRun
 * @property {boolean} [abandonHoldActive]
 * @property {number} [abandonHoldRemainingMs]
 * @property {boolean} regen
 * @property {boolean} toggleDebug
 * @property {boolean} toggleDevHud
 * @property {boolean} [toggleFrameStep]
 * @property {boolean} togglePlanetView
 * @property {boolean} toggleRingVertices
 * @property {boolean} togglePlanetTriangles
 * @property {boolean} toggleCollisionContours
 * @property {boolean} toggleMinerGuidePath
 * @property {boolean} toggleFog
 * @property {boolean} toggleMusic
 * @property {boolean} toggleCombatMusic
 * @property {boolean} musicVolumeUp
 * @property {boolean} musicVolumeDown
 * @property {boolean} copyScreenshot
 * @property {boolean} copyScreenshotClean
 * @property {boolean} copyScreenshotCleanTitle
 * @property {boolean} nextLevel
 * @property {boolean} prevLevel
 * @property {boolean} [zoomReset]
 * @property {boolean} shootHeld
 * @property {boolean} shootPressed
 * @property {boolean} [shoot]
 * @property {boolean} bomb
 * @property {boolean} rescueAll
 * @property {boolean} killAllEnemies
 * @property {EnemyType|null} [spawnEnemyType]
 * @property {Point|null} [aim]
 * @property {Point|null} [aimShoot]
 * @property {Point|null} [aimBomb]
 * @property {Point|null} [aimShootFrom]
 * @property {Point|null} [aimShootTo]
 * @property {Point|null} [aimBombFrom]
 * @property {Point|null} [aimBombTo]
 * @property {{leftTouch:Point|null,laserTouch:Point|null,bombTouch:Point|null}|null} [touchUi]
 * @property {boolean} [touchUiVisible]
 * @property {number} [zoomDelta]
 * @property {boolean} [stepFrame]
 * @property {"keyboard"|"mouse"|"touch"|"gamepad"|null} [inputType]
 */

export {};
