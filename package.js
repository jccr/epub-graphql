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

  readAttribute(expression) {
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

const ID = (superclass) =>
  class extends superclass {
    id() {
      return this.readAttribute('./@id')
    }
  }

const Refines = (superclass) =>
  class extends superclass {
    refines() {
      return this.readAttribute('./@refines')
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
      return this.readAttribute('./@dir')
    }

    lang() {
      return this.readAttribute('./@xml:lang')
    }
  }

const PropertiesList = (superclass) =>
  class extends superclass {
    properties() {
      const properties = this.readAttribute('./@properties')
      if (properties) {
        //normalize spaces and split space separated words
        return properties.replace(/\s+/g, ' ').split(' ')
      }
    }
  }

const MetadataNode = (superclass) =>
  class extends superclass {
    constructor(node, metadata) {
      super(node)
      this.metadata = metadata
    }
  }

const MetaAttributes = (superclass) =>
  class extends superclass {
    property() {
      return this.readAttribute('./@property')
    }

    scheme() {
      return this.readAttribute('./@scheme')
    }
  }

const createMetaOrNull = (context, property) => {
  const id = context.id()
  const propertyMap = context.metadata.metaPropertyMap[id]
  if (!propertyMap) {
    return null
  }

  const metaNode = propertyMap[property]
  if (!metaNode) {
    return null
  }

  return new Meta(metaNode, context.metadata)
}

const MetaProperties = (superclass) =>
  class extends superclass {
    alternateScript() {
      return createMetaOrNull(this, 'alternate-script')
    }

    displaySeq() {
      return createMetaOrNull(this, 'display-seq')
    }

    fileAs() {
      return createMetaOrNull(this, 'file-as')
    }

    groupPosition() {
      return createMetaOrNull(this, 'group-position')
    }

    metaAuth() {
      return createMetaOrNull(this, 'meta-auth')
    }
  }

class Meta extends mix(Node).with(
  MetadataNode,
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
  constructor(node, manifest) {
    super(node)
    this.manifest = manifest
  }

  pageProgressionDirection() {
    return this.readAttribute('./@page-progression-direction')
  }

  toc() {
    const idref = this.readAttribute('./@toc')
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

class SpineItem extends mix(Node).with(ID, PropertiesList) {
  constructor(node, spine) {
    super(node)
    this.spine = spine
  }

  idref() {
    const idref = this.readAttribute('./@idref')
    if (idref) {
      return toArray(this.spine.manifest.item({ id: idref }))[0]
    }
  }

  linear() {
    const linear = this.readAttribute('./@linear')
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
    return this.readAttribute('./@href')
  }

  mediaType() {
    return this.readAttribute('./@media-type')
  }

  mediaOverlay() {
    const idref = this.readAttribute('./@media-overlay')
    if (idref) {
      return toArray(this.manifest.item({ id: idref }))[0]
    }
  }

  fallback() {
    const idref = this.readAttribute('./@fallback')
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

class Identifier extends mix(Node).with(
  MetadataNode,
  ID,
  Value,
  MetaProperties
) {
  identifierType() {
    return createMetaOrNull(this, 'identifier-type')
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

  identifier() {
    const node = this.select('./dc:identifier')
    return new Identifier(node, this)
  }
}

export class Package extends mix(Node).with(ID, I18n) {
  constructor(doc) {
    super(select('/opf:package', doc))
  }

  version() {
    return this.readAttribute('./@version')
  }

  uniqueIdentifier() {
    return null
  }

  releaseIdentifier() {
    return null
  }

  metadata() {
    const node = this.select('./opf:metadata')
    return new Metadata(node)
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
