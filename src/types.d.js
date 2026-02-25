// @ts-check

/**
 * @typedef {[number, number]} Vec2
 * @typedef {{x:number,y:number}} Point
 */

/**
 * @typedef {Object} MapGrid
 * @property {number} G
 * @property {number} cell
 * @property {number} worldMin
 * @property {number} worldMax
 * @property {number} worldSize
 * @property {number} R2
 * @property {Uint8Array<ArrayBufferLike>} inside
 * @property {(i:number, j:number) => number} idx
 * @property {(i:number, j:number) => Vec2} toWorld
 * @property {(x:number, y:number) => [number, number]} toGrid
 */

/**
 * @typedef {Object} MapWorld
 * @property {number} seed
 * @property {Uint8Array<ArrayBufferLike>} air
 * @property {Vec2[]} entrances
 * @property {number} finalAir
 */

/**
 * @typedef {{updateHud:(hud:HTMLElement, stats:{fps:number,state:string,speed:number,verts:number,air:number,miners:number,minersDead:number,level:number,debug:boolean,minerCandidates:number})=>void}} Ui
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
 * @property {Array<[number,number,boolean,number]>|null} [_samples]
 * @property {{x:number,y:number,tri?:Array<{x:number,y:number}>|null,node?:{x:number,y:number}|null}|null} [_collision]
 * @property {number} [_shipRadius]
 */

/**
 * @typedef {Object} Miner
 * @property {number} x
 * @property {number} y
 * @property {"idle"|"running"|"boarded"} state
 */

/**
 * @typedef {Object} Mesh
 * @property {Float32Array<ArrayBufferLike>} positions
 * @property {Float32Array<ArrayBufferLike>} airFlag
 * @property {Float32Array<ArrayBufferLike>} shade
 * @property {number} vertCount
 * @property {Array<{x:number,y:number}[]>} rings
 * @property {Array<Array<Array<{x:number,y:number}>>>} bandTris
 * @property {(x:number, y:number) => 0|1|number} airValueAtWorld
 * @property {(x:number, y:number) => {x:number,y:number}|null} nearestNodeOnRing
 * @property {(x:number, y:number) => Array<{x:number,y:number}>|null} findTriAtWorld
 * @property {() => Float32Array<ArrayBufferLike>} updateAirFlags
 */

/**
 * @typedef {"hunter"|"ranger"|"crawler"} EnemyType
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
 * @property {number} dir
 * @property {number} fuse
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
 * @property {{x:number,y:number,vx:number,vy:number,state:string,explodeT:number,_samples?:Array<[number,number,boolean,number]>|null,_collision?:{x:number,y:number,tri?:Array<{x:number,y:number}>|null,node?:{x:number,y:number}|null}|null}} ship
 * @property {Array<{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number}>} debris
 * @property {{left:boolean,right:boolean,thrust:boolean,down:boolean}} input
 * @property {boolean} debugCollisions
 * @property {boolean} debugNodes
 * @property {number} fps
 * @property {number} finalAir
 * @property {Array<{x:number,y:number,state:string}>} miners
 * @property {number} minersRemaining
 * @property {number} level
 * @property {number} minersDead
 * @property {Array<{x:number,y:number,type:string,vx?:number,vy?:number,cooldown?:number,hp?:number,dir?:number,fuse?:number}>} enemies
 * @property {Array<{x:number,y:number,vx?:number,vy?:number,life?:number,owner:string}>} shots
 * @property {Array<{x:number,y:number,life:number,owner:string,radius?:number}>} explosions
 * @property {Array<{x:number,y:number,vx?:number,vy?:number,a:number,w?:number,life:number}>} enemyDebris
 * @property {Array<{x:number,y:number,vx?:number,vy?:number,life?:number}>} playerShots
 * @property {Array<{x:number,y:number,vx?:number,vy?:number,life?:number}>} playerBombs
 * @property {Array<{x:number,y:number,life:number,radius?:number}>} playerExplosions
 * @property {{x:number,y:number}|null} aimWorld
 * @property {{leftTouch:{x:number,y:number}|null,laserTouch:{x:number,y:number}|null,bombTouch:{x:number,y:number}|null}|null|undefined} touchUi
 */

/**
 * @typedef {Object} InputState
 * @property {boolean} left
 * @property {boolean} right
 * @property {boolean} thrust
 * @property {boolean} down
 * @property {boolean} reset
 * @property {boolean} regen
 * @property {boolean} toggleDebug
 * @property {boolean} nextLevel
 * @property {boolean} shoot
 * @property {boolean} bomb
 * @property {Point|null} [aim]
 * @property {Point|null} [aimShoot]
 * @property {Point|null} [aimBomb]
 * @property {Point|null} [aimShootFrom]
 * @property {Point|null} [aimShootTo]
 * @property {Point|null} [aimBombFrom]
 * @property {Point|null} [aimBombTo]
 * @property {{leftTouch:Point|null,laserTouch:Point|null,bombTouch:Point|null}|null} [touchUi]
 * @property {boolean} [touchUiVisible]
 */

export {};
