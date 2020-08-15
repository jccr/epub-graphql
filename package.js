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

const namespaceMap = {
  xml: 'http://www.w3.org/XML/1998/namespace',
  opf: 'http://www.idpf.org/2007/opf',
  dc: 'http://purl.org/dc/elements/1.1/',
}

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

  resolveAttribute(expression) {
    const node = this.select(expression)
    if (node) {
      return node.value
    }
  }

  resolveNode(expression, constructor, context) {
    const node = this.select(expression)
    if (node) {
      return new constructor(node, context)
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

// Node mixins

const ID = (superclass) =>
  class extends superclass {
    id() {
      return this.resolveAttribute('./@id')
    }
  }

const Refines = (superclass) =>
  class extends superclass {
    refines() {
      return this.resolveAttribute('./@refines')
    }
  }

const Value = (superclass) =>
  class extends superclass {
    value() {
      const textNode = this.select('./text()')
      if (textNode) {
        return textNode.data
      }
    }
  }

const I18n = (superclass) =>
  class extends superclass {
    dir() {
      return this.resolveAttribute('./@dir')
    }

    lang() {
      return this.resolveAttribute('./@xml:lang')
    }
  }

const PropertiesList = (superclass) =>
  class extends superclass {
    properties() {
      const properties = this.resolveAttribute('./@properties')
      if (properties) {
        //normalize spaces and split space separated words
        return properties.replace(/\s+/g, ' ').split(' ')
      }
    }
  }

const MetaAttributes = (superclass) =>
  class extends superclass {
    property() {
      return this.resolveAttribute('./@property')
    }

    scheme() {
      return this.resolveAttribute('./@scheme')
    }
  }

const MetaProperties = (superclass) =>
  class extends superclass {
    constructor(node, { metadata }) {
      super(node)
      this.metadata = metadata
    }

    resolveMetaProperty(property) {
      const id = this.id()
      const propertyMap = this.metadata.metaPropertyMap[id]
      if (!propertyMap) {
        return null
      }

      const metaNode = propertyMap[property]
      if (!metaNode) {
        return null
      }

      return new Meta(metaNode, { metadata: this.metadata })
    }

    alternateScript() {
      return this.resolveMetaProperty('alternate-script')
    }

    displaySeq() {
      return this.resolveMetaProperty('display-seq')
    }

    fileAs() {
      return this.resolveMetaProperty('file-as')
    }

    groupPosition() {
      return this.resolveMetaProperty('group-position')
    }

    metaAuth() {
      return this.resolveMetaProperty('meta-auth')
    }
  }

class Meta extends mix(Node).with(
  ID,
  Value,
  I18n,
  Refines,
  MetaAttributes,
  MetaProperties
) {}

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
  constructor(node, { manifest }) {
    super(node)
    this.manifest = manifest
  }

  pageProgressionDirection() {
    return this.resolveAttribute('./@page-progression-direction')
  }

  toc() {
    const idref = this.resolveAttribute('./@toc')
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

    return this.mapAll(
      expression,
      (node) => new SpineItem(node, { spine: this })
    )
  }
}

class SpineItem extends mix(Node).with(ID, PropertiesList) {
  constructor(node, { spine }) {
    super(node)
    this.spine = spine
  }

  idref() {
    const idref = this.resolveAttribute('./@idref')
    if (idref) {
      return toArray(this.spine.manifest.item({ id: idref }))[0]
    }
  }

  linear() {
    const linear = this.resolveAttribute('./@linear')
    if (linear === 'no') {
      return false
    }
    return true
  }
}

class ManifestItem extends mix(Node).with(ID, PropertiesList) {
  constructor(node, manifest) {
    super(node)
    this.manifest = manifest
  }

  href() {
    return this.resolveAttribute('./@href')
  }

  mediaType() {
    return this.resolveAttribute('./@media-type')
  }

  mediaOverlay() {
    const idref = this.resolveAttribute('./@media-overlay')
    if (idref) {
      return toArray(this.manifest.item({ id: idref }))[0]
    }
  }

  fallback() {
    const idref = this.resolveAttribute('./@fallback')
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

class Identifier extends mix(Node).with(ID, Value, MetaProperties) {
  identifierType() {
    return this.resolveMetaProperty('identifier-type')
  }
}

class Metadata extends Node {
  constructor(node) {
    super(node)

    this.metaPropertyMap = {}

    const metaRefiningNodes = toArray(
      this.selectAll('./opf:meta[@refines and @property]')
    )

    metaRefiningNodes.forEach((meta) => {
      const refinesAttr = select('./@refines', meta)
      if (!refinesAttr) {
        return
      }
      const refinesValue = refinesAttr.value

      // drop the # prefix
      const idRefined =
        refinesValue[0] === '#' ? refinesValue.substr(1) : refinesValue

      const propertyAttr = select('./@property', meta)
      if (!propertyAttr) {
        return
      }
      const property = propertyAttr.value

      if (!this.metaPropertyMap[idRefined]) {
        this.metaPropertyMap[idRefined] = {}
      }

      this.metaPropertyMap[idRefined][property] = meta
    })
  }

  identifier({ id }) {
    return this.resolveNode(`./dc:identifier${idFilter(id)}`, Identifier, {
      metadata: this,
    })
  }

  modified() {
    const node = this.select(
      "./opf:meta[@property='dcterms:modified' and not(@refines)]"
    )
    if (node) {
      return new Meta(node, { metadata: this })
    }
  }
}

export class Package extends mix(Node).with(ID, I18n) {
  constructor(doc) {
    super(select('/opf:package', doc))
  }

  version() {
    return this.resolveAttribute('./@version')
  }

  uniqueIdentifier() {
    const uniqueIdentifierIDRef = this.resolveAttribute('./@unique-identifier')
    if (uniqueIdentifierIDRef) {
      return this.metadata().identifier({ id: uniqueIdentifierIDRef })
    }
  }

  releaseIdentifier() {
    const uniqueIdentifier = this.uniqueIdentifier()
    const modified = this.metadata().modified()
    if (uniqueIdentifier && modified) {
      return `${uniqueIdentifier.value()}@${modified.value()}`
    }
  }

  metadata() {
    return (this._metadata =
      this._metadata || this.resolveNode('./opf:metadata', Metadata, {}))
  }

  spine() {
    return (this._spine =
      this._spine ||
      this.resolveNode('./opf:spine', Spine, { manifest: this.manifest() }))
  }

  manifest() {
    return (this._manifest =
      this._manifest || this.resolveNode('./opf:manifest', Manifest, {}))
  }
}
