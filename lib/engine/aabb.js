'use strict'

// Minimal immutable-style AABB matching net.minecraft.world.phys.AABB semantics.
class AABB {
  constructor (minX, minY, minZ, maxX, maxY, maxZ) {
    this.minX = Math.min(minX, maxX)
    this.minY = Math.min(minY, maxY)
    this.minZ = Math.min(minZ, maxZ)
    this.maxX = Math.max(minX, maxX)
    this.maxY = Math.max(minY, maxY)
    this.maxZ = Math.max(minZ, maxZ)
  }

  move (x, y, z) {
    return new AABB(this.minX + x, this.minY + y, this.minZ + z, this.maxX + x, this.maxY + y, this.maxZ + z)
  }

  expandTowards (x, y, z) {
    let minX = this.minX; let minY = this.minY; let minZ = this.minZ
    let maxX = this.maxX; let maxY = this.maxY; let maxZ = this.maxZ
    if (x < 0) minX += x; else if (x > 0) maxX += x
    if (y < 0) minY += y; else if (y > 0) maxY += y
    if (z < 0) minZ += z; else if (z > 0) maxZ += z
    return new AABB(minX, minY, minZ, maxX, maxY, maxZ)
  }

  inflate (x, y = x, z = x) {
    return new AABB(this.minX - x, this.minY - y, this.minZ - z, this.maxX + x, this.maxY + y, this.maxZ + z)
  }

  deflate (v) {
    return this.inflate(-v)
  }

  // strict positive-volume intersection (Shapes.joinIsNotEmpty(..., AND))
  intersectsBox (b) {
    return this.intersects(b[0], b[1], b[2], b[3], b[4], b[5])
  }

  intersects (minX, minY, minZ, maxX, maxY, maxZ) {
    return minX < this.maxX && maxX > this.minX && minY < this.maxY && maxY > this.minY && minZ < this.maxZ && maxZ > this.minZ
  }

  min (axis) { return axis === 0 ? this.minX : (axis === 1 ? this.minY : this.minZ) }
  max (axis) { return axis === 0 ? this.maxX : (axis === 1 ? this.maxY : this.maxZ) }
}

module.exports = AABB
