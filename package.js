import xpath from 'xpath'

let mix = (superclass) => new MixinBuilder(superclass)

class MixinBuilder {
  constructor(superclass) {
    this.superclass = superclass
  }

  with(...mixins) {
    return mixins.reduce((c, mixin) => mixin(c), this.superclass)
  }
}

const namespaceMap = { opf: 'http://www.idpf.org/2007/opf' }

const selectAll = xpath.useNamespaces(namespaceMap)
const select = function (expression, node) {
  return selectAll(expression, node, true)
}

class Node {
  constructor(node) {
    this.node = node
  }

  select(expression) {
    return select(expression, this.node)
  }

  selectAll(expression) {
    return selectAll(expression, this.node)
  }

  selectAttr(expression) {
    const node = this.select(expression)
    if (node) {
      return node.value
    }
  }

  map(expression, constructor) {
    const node = this.select(expression)
    if (node) {
      return constructor(node)
    }
  }

  mapAll(expression, constructor) {
    const nodes = this.selectAll(expression)
    return nodes.map((node) => constructor(node))
  }
}

let ID = (superclass) =>
  class extends superclass {
    id() {
      return this.selectAttr('./@id')
    }
  }

let Properties = (superclass) =>
  class extends superclass {
    properties() {
      const properties = this.selectAttr('./@properties')
      if (properties) {
        //normalize spaces and split space separated words
        return properties.replace(/\s+/g, ' ').split(' ')
      }
    }
  }

const toArray = (valueOrArray) =>
  Array.isArray(valueOrArray) ? valueOrArray : [valueOrArray]

const attributeFilter = (attribute, values, operator) =>
  values
    ? `[${toArray(values)
        .map((value) => `${attribute}='${value}'`)
        .join(` ${operator} `)}]`
    : ''

const attributeContainsWordFilter = (attribute, words, operator) =>
  words
    ? `[${toArray(words)
        .map(
          (value) =>
            `contains(concat(' ', normalize-space(${attribute}), ' '), ' ${value} ')`
        )
        .join(` ${operator} `)}]`
    : ''

const idFilter = (id) => attributeFilter('@id', id, 'or')
const anyPropertiesFilter = (anyProperties) =>
  attributeContainsWordFilter('@properties', anyProperties, 'or')
const allPropertiesFilter = (allProperties) =>
  attributeContainsWordFilter('@properties', allProperties, 'and')

class Spine extends mix(Node).with(ID) {
  constructor(node, manifest) {
    super(node)
    this.manifest = manifest
  }

  pageProgressionDirection() {
    return this.selectAttr('./@page-progression-direction')
  }

  toc() {
    const idref = this.selectAttr('./@toc')
    if (idref) {
      return toArray(this.manifest.item({ id: idref }))[0]
    }
  }

  itemref({ id, anyProperties, allProperties, onlyProperties, linear }) {
    if (linear !== undefined) {
      return this.itemref({
        id,
        anyProperties,
        allProperties,
        onlyProperties,
      }).filter((item) => item.linear() === linear)
    }

    if (onlyProperties) {
      return this.itemref({
        id,
        anyProperties,
        allProperties: onlyProperties,
      }).filter((item) => item.properties().length === onlyProperties.length)
    }

    const expression = `./opf:itemref${idFilter(id)}${anyPropertiesFilter(
      anyProperties
    )}${allPropertiesFilter(allProperties)}`

    return this.mapAll(expression, (node) => new SpineItem(node, this))
  }
}

class SpineItem extends mix(Node).with(ID, Properties) {
  constructor(node, spine) {
    super(node)
    this.spine = spine
  }

  idref() {
    const idref = this.selectAttr('./@idref')
    if (idref) {
      return toArray(this.spine.manifest.item({ id: idref }))[0]
    }
  }

  linear() {
    const linear = this.selectAttr('./@linear')
    if (linear === 'no') {
      return false
    }
    return true
  }
}

class ManifestItem extends mix(Node).with(ID, Properties) {
  constructor(node, manifest) {
    super(node)
    this.manifest = manifest
  }

  href() {
    return this.selectAttr('./@href')
  }

  mediaType() {
    return this.selectAttr('./@media-type')
  }

  mediaOverlay() {
    const idref = this.selectAttr('./@media-overlay')
    if (idref) {
      return toArray(this.manifest.item({ id: idref }))[0]
    }
  }

  fallback() {
    const idref = this.selectAttr('./@fallback')
    if (idref) {
      return toArray(this.manifest.item({ id: idref }))[0]
    }
  }
}

class Manifest extends mix(Node).with(ID) {
  item({ id, anyProperties, allProperties, onlyProperties }) {
    if (onlyProperties) {
      return this.item({
        id,
        anyProperties,
        allProperties: onlyProperties,
      }).filter((item) => item.properties().length === onlyProperties.length)
    }

    const expression = `./opf:item${idFilter(id)}${anyPropertiesFilter(
      anyProperties
    )}${allPropertiesFilter(allProperties)}`

    return this.mapAll(expression, (node) => new ManifestItem(node, this))
  }
}

export class Package extends Node {
  constructor(doc) {
    super(select('/opf:package', doc))
  }

  spine() {
    const node = this.select('./opf:spine')
    return new Spine(node, this.manifest())
  }

  manifest() {
    const node = this.select('./opf:manifest')
    return new Manifest(node)
  }
}
