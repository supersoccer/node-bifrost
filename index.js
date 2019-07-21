// const MistyLoader = require('@supersoccer/misty-loader')
const { Log, Config, Mystique, Utils, Dwarfs, Yggdrasil, Heimdallr } = require('@supersoccer/misty-loader')
const { Lodash, Moment, Url, Mixin, Path, Env } = Utils
const _ = Lodash
const mystique = new Mystique()

const methodSource = [
  {
    name: 'Manage',
    method: 'index',
    route_method: 'GET',
    route_path: '/list',
    visible: 1,
    permit: 'read',
    permission: 1
  },
  {
    name: 'Create',
    method: 'create',
    route_method: 'GET',
    route_path: '/create',
    visible: 1,
    permit: 'write',
    permission: 3
  },      
  {
    name: 'Store',
    method: 'store',
    route_method: 'POST',
    route_path: '/create',
    visible: 0,
    permit: 'write',
    permission: 3
  },
  {
    name: 'Edit',
    method: 'edit',
    route_method: 'GET',
    route_path: '/:primaryId/edit',
    visible: 0,
    permit: 'update',
    permission: 5
  },
  {
    name: 'Edit',
    method: 'update',
    route_method: 'POST',
    route_path: '/:primaryId/edit',
    visible: 0,
    permit: 'update',
    permission: 5
  },      
  {
    name: 'Show',
    method: 'show',
    route_method: 'GET',
    route_path: '/:primaryId/show',
    visible: 0,
    permit: 'read',
    permission: 1
  },
  {
    name: 'Destroy',
    method: 'destroy',
    route_method: 'POST',
    route_path: '/:primaryId/delete',
    visible: 0,
    permit: 'delete',
    permission: 15
  }
]

class Bifrost {
  constructor () {
    this.MENU = 1
    this.ROUTES = 2
    this.collectionRoutes = []

    this.services = {}
    this.getTreeModules = this.getTreeModules.bind(this)
    this._getFlatModules = this._getFlatModules.bind(this)
    this._mapModuleNames = this._mapModuleNames.bind(this)
    this.utils = this.utils.bind(this)
    this.apps = this.apps.bind(this)
    this.moduleName = this.moduleName.bind(this)
    this.registerMenu = this.registerMenu.bind(this)
  }

  cache () {
    this.cache = new Yggdrasil(Config.App.name)
  }

  _getModules () {
    // TODO: make this dynamic
    return new Promise((resolve, reject) => {
      Dwarfs.get({
        app: Config.App.name,
        key: 'modules-raw',
        query: {
          sql: `SELECT * FROM ${Config.Bifrost.tables.modules} WHERE deleted_at IS NULL`
        }
      }).then(this._setDefaultModule).then((modules) => {
        let modulesRaw = modules
        let startId = 10000
        let newRoutes = []
        modules.map((module, index) => {
          modulesRaw[index].permission = 1
          modulesRaw[index].moduleScope = module.scope

          if (module.method === 'resource') {
            modulesRaw[index].method = 'index'

            methodSource.map((dataSource, index) => {
              let newModule = Object.assign({}, dataSource)
              newModule.id = startId++
              newModule.parent_id = module.id
              newModule.api_based = module.api_based
              newModule.type = 2
              newModule.description = ''
              newModule.icon = null
              newModule.middlewares = null
              newModule.module = module.module
              newModule.auth = 1
              newModule.default = 0
              newModule.menu_order = 0
              newModule.route_order = 0
              newModule.created_at = '2018-06-05T13:10:15.000Z'
              newModule.updated_at = null
              newModule.deleted_at = null

              newModule.slug = dataSource.method + '-' + module.slug
              
              if (index === 0 && !_.isNull(module.index_label)) {
                newModule.name = module.index_label
              } else if (index === 1 && !_.isNull(module.create_label)) {
                newModule.name = module.create_label
              } else if (index === 2 && !_.isNull(module.edit_label)) {
                newModule.name = module.edit_label
              } else {
                newModule.name = newModule.name +' '+ module.name
              }

              if ([0,5].indexOf(index) >= 0) {
                newModule.moduleScope = module.scope
              }

              if ([1,2].indexOf(index) >= 0) {
                newModule.moduleScope = module.create_scope
              }

              if ([3,5].indexOf(index) >= 0) {
                newModule.moduleScope = module.edit_scope
              }

              if ([4,6].indexOf(index) >= 0) {
                newModule.moduleScope = module.delete_scope
              }

              if (parseInt(module.resource_limit) >= index) {
                newRoutes.push(newModule)
              }
            })

            if (module.nested_id) {
              modulesRaw[index].route_path = '/:nestedId' + modulesRaw[index].route_path
            }
          }
        })

        Array.prototype.push.apply(modulesRaw, newRoutes)
        resolve(modulesRaw)
      }).catch((err) => {
        resolve(err)
      })
    })
  }

  _setDefaultModule (modules) {
    for (let module of modules) {
      if (module.default) {
        let defaultModule = _.clone(module)
        defaultModule.parent_id = 0
        defaultModule.route_path = '/'
        modules.unshift(defaultModule)
        break
      }
    }

    return Promise.resolve(modules)
  }

  _setParents (obj, parents) {
    if (_.isUndefined(parents)) {
      parents = []
      for (let item of obj) {
        if (parents.indexOf(item.parent_id) < 0) {
          parents.push(item.parent_id)
        }
      }
    }

    return parents
  }

  _setChilds (obj, type, parentId, parents, route, tmp) {
    for (let item of obj) {
      if (this._getTreeCondition(type, item, parentId)) {
        this._concatInheritedRoutePath(item, route)

        if (parents.indexOf(item.id) >= 0) {
          item.childs = this.tree(obj, type, item.id, parents, item.route_path)
        }

        tmp.push(item)
      }
    }
  }

  tree (obj, type, parentId, parents, route) {
    let tmp = []
    parentId = parentId || 0
    route = route || ''
    type = type || this.MENU
    parents = this._setParents(obj, parents)
    this._setChilds(obj, type, parentId, parents, route, tmp)
    tmp = _.sortBy(tmp, ['menu_order'])
    return tmp
  }

  _concatInheritedRoutePath (item, route) {
    item.route_path = `${route}/${item.route_path.replace(/^\//, '')}`
    item.route_path = item.route_path === '/*' ? '*' : item.route_path
  }  

  _getTreeCondition (type, item, parentId) {
    switch (type) {
      case this.MENU:
        return item.parent_id === parentId && item.visible !== 0
      case this.ROUTES:
        return item.parent_id === parentId
    }
  }

  getTreeModules (modules) {
    const key = 'modules-tree'
    return this.cache.get(key).then(modulesTree => {
      if (_.isNull(modulesTree)) {
        modulesTree = this.tree(modules)

        this.cache.set(key, modulesTree)
      }

      return modulesTree
    })
  }

  _getFlatModules (modules) {
    const key = 'modules-flat'
    return this.cache.get(key).then(modulesFlat => {
      if (_.isNull(modulesFlat)) {
        modulesFlat = this._flatten(this.tree(modules, this.ROUTES))
        modulesFlat = _.sortBy(modulesFlat, ['route_order'])

        this.cache.set(key, modulesFlat)
      }

      return modulesFlat
    })
  }

  _mapModuleNames (modules) {
    const key = 'modules-map'
    return this.cache.get(key).then(modulesMap => {
      if (_.isNull(modulesMap)) {
        return this._getFlatModules(modules)
      }

      return modulesMap
    }).then(flatModules => {
      if (!_.isArray(flatModules)) {
        return flatModules
      }

      const modulesMap = {}

      for (let module of flatModules) {
        modulesMap[`${module.route_method}:${module.route_path}`] = module
      }

      this.cache.set(key, modulesMap)
      return modulesMap
    })
  }

  utils (req, res, next) {
    res.locals.Utils = { Lodash, Moment, Path, Mixin }
    res.locals.Utils.Env = new Env(req, res)
    res.locals.Utils.Url = new Url(res.locals)
    res.locals.Utils.Mystique = Mystique
    res.locals.Utils.Heimdallr = Heimdallr.utils(req, res)
    next()
  }

  _getApps () {
    return Dwarfs.get({
      app: Config.App.name,
      key: 'apps-raw',
      query: {
        sql: `SELECT * FROM ${Config.Bifrost.tables.apps} WHERE deleted_at IS NULL`
      }
    })
  }

  apps (req, res, next) {
    this._getApps().then(apps => {
      res.locals.apps = apps

      const app = this.appIdByDomain(req.headers, apps) || this.appIdByQuery(req.query, apps)

      if (app) {
        res.locals.app = _.find(apps, { id: app.appId })
        res.locals.appId = app.appId
        res.locals.appLock = app.appLock

        if (!_.isUndefined(req.headers['x-url'])) {
          res.locals.xURL = req.headers['x-url']
        }

        if (_.isNumber(res.locals.appId) && !_.isUndefined(res.locals.app)) {
          res.locals.appId = (res.locals.app).identifier
        }
      }

      next()
    })
  }

  appIdByDomain (headers, apps) {
    let appDomain = Utils.Url.cleanAppDomainUrl(headers['x-url'])

    if (_.isUndefined(appDomain)) {
      return
    }

    const app = _.find(apps, (o) => {
      const hosts = (o.host).split(' ')
      return hosts.indexOf(appDomain) >= 0
    })

    if (app) {
      return { appId: app.id, appLock: true }
    }
  }

  appIdByQuery (query, apps) {
    if (_.isUndefined(query)) {
      return
    }

    if (_.isUndefined(query.app)) {
      return
    }

    const appId = query.app.replace(/[^0-9a-z_-]*/i, '')

    if (!_.isUndefined(_.find(apps, { identifier: appId }))) {
      return { appId: appId, appLock: false }
    }
  }

  moduleName (req, res, next) {
    this._getModules().then(this._mapModuleNames).then(modules => {
      const key = `${req.method.toUpperCase()}:${req.route.path}`
      res.locals.module = modules[key]
      res.locals.path = req.path
      res.locals.method = req.method
      res.locals.modules = _.values(modules)
      next()
    }).catch(error => {
      res.locals.module = null
      console.error(error)
      next()
    })
  }

  _menu () {
    return this._getModules().then(this.getTreeModules)
  }

  _hasAccess (roles, module, superuser, access, modules) {
    const { appId, apps } = access
    const currentApp = apps.find(x => x.identifier === appId)
    let haveAccess = false

    if(currentApp) {
      const modulesIdx = JSON.parse(currentApp.modules)
      if (modulesIdx.find(x => parseInt(x) === module.id)) {
        haveAccess = true
      }
      
      if (!_.isUndefined(modules)) {
        if (module.id >= 1000 && modules.find(x => modulesIdx.indexOf(x.parent_id))) {
          haveAccess = true
        }  
      }
    }

    if (module.visible === -1 || superuser) {
      if (haveAccess) {
        return true
      }
    }

    const role = _.find(roles, { moduleId: module.id })
    if(!_.isUndefined(module.permit) && !_.isUndefined(role)) {
      return role.roles[module.permit]
    }

    if (_.isUndefined(role)) {
      return false
    }

    if(superuser) {
      return haveAccess
    }
    
    return role.roles.read
  }  

  _pushValidItem (items, item, hasChilds, depth) {
    if ((depth === 0 && !hasChilds) || (depth === 1 && hasChilds && item.childs.length === 0)) {
      return
    }

    items.push(item)
  }

  _authorizedMenuItems (menuItems, res, depth) {
    const access = {
      appId: res.locals.appId,
      apps: res.locals.apps
    }

    const roles = res.locals.IAM.roles
    const superuser = res.locals.IAM.superuser
    const moduleId = res.locals.module.id
    const items = []
    depth = depth || 0

    for (let item of menuItems) {
      if (!this._hasAccess(roles, item, superuser, access, res.locals.modules)) {
        continue
      }

      if (item.id === moduleId) {
        item.active = true
      }

      const hasChilds = !_.isUndefined(item.childs)

      if (hasChilds) {
        item.childs = this._authorizedMenuItems(item.childs, res, depth + 1)

        if (item.childs.length > 0) {
          if (_.find(item.childs, { active: true })) {
            item.childActive = true
          }
        }
      }

      this._pushValidItem(items, item, hasChilds, depth)
    }

    return items
  }

  registerMenu (req, res, next) {
    const roles = res.locals.IAM.roles

    this._menu().then(menuItems => {
      res.locals.menuItems = this._authorizedMenuItems(menuItems, res)
      next()
    }).catch(error => {
      res.locals.menuItems = null
      console.error(error)
      next()
    })
  }

  _flatten (obj) {
    let tmp = []

    for (let item of obj) {
      tmp.push(item)
      let idx = tmp.length - 1

      if (item.childs) {
        tmp = tmp.concat(this._flatten(item.childs))
        delete tmp[idx].childs
      }
    }

    return tmp
  }

  _registerDefaultMiddlewares (params, module) {
    params.push(this._favicon)
    params.push(this._query)
    params.push(mystique.render)
    params.push(this.apps)
    params.push(this.utils)
    if (Config.Bifrost.whitelist.indexOf(module.route_path) < 0) {
      params.push(Heimdallr.passport)
    }
    params.push(this.moduleName)

    if (Config.Bifrost.whitelist.indexOf(module.route_path) < 0) {
      params.push(Heimdallr.access)
      params.push(this.registerMenu)
    }

    params.push(this.validateModule)
    params.push(this.validateAppID)
    params.push(this.validateAccess)
  }

  _registerRoutePath (params, module) {
    params.push(module.route_path)
  }

  _registerModuleMiddlewares (params, module) {
    if (module.middlewares) {
      const middlewares = module.middlewares.split(',').map((middleware) => {
        return middleware.split('.')
      })

      for (let [ module, method ] of middlewares) {
        params.push(this._service(module, method))
      }
    }
  }

  _registerModuleService (params, module) {
    params.push(this._service(module.module, module.method))
  }

  _registerNotFoundRoutes (app) {
    app.get('*', this.pageNotFound)
    app.post('*', this.pageNotFound)
  }

  routes (app) {
    this.cache()
    
    return this._getModules().then(this._getFlatModules).then(modules => {
      this._registerServices('heimdallr')
      for (let module of modules) {
        const params = []
        this._registerServices(module.module)
        this._registerRoutePath(params, module)
        this._registerDefaultMiddlewares(params, module)
        this._registerModuleMiddlewares(params, module)
        this._registerModuleService(params, module)
        this._registerRoute(app, module.route_method, params)
      }
      this._registerNotFoundRoutes(app)
      this._printRegisteredRoutes(app)
    }).catch(error => {
      console.error(error)
    })
  }

  _printRegisteredRoutes (app) {
    Log.print()
    Log.Bifrost('registering routes...')
    app._router.stack.forEach(val => {
      if (val.route) {
        Log.Bifrost(`${val.route.stack[0].method} ${val.route.path}`)
      }
    })
  }

  _registerRoute (app, method, params) {
    app[method.toLowerCase()](...params)
  }

  serviceNotFound (req, res) {
    res.send('Service not found')
  }

  pageNotFound (req, res) {
    res.sendStatus(404)
  }

  _registerServices (service) {
    if (_.isUndefined(this.services[service])) {
      Log.Bifrost(`register ${service} service`)
      if (service === 'heimdallr') {
        this.services[service] = Heimdallr
        return
      }
      try {
        const servicePath = Utils.Path.basepath.services(service)
        this.services[service] = require(servicePath)
      } catch (e) {
        throw new Error(`Cannot import service module ${service} with ${e}`)
      }
    }
  }

  _service (service, method) {
    if (!_.isUndefined(this.services[service])) {
      if (!_.isUndefined(this.services[service][method])) {
        return this.services[service][method]
      }
    }

    return this.serviceNotFound
  }

  _favicon (req, res, next) {
    if (req.path === '/favicon.ico') {
      return res.sendStatus(200)
    }
    next()
  }

  _query (req, res, next) {
    if (req.query) {
      res.locals.query = req.query
    }
    next()
  }

  validateAppID (req, res, next) {
    let path = req.path
    if (typeof res.locals.module.route_path !== 'undefined') {
      path = res.locals.module.route_path
    }

    if (res.locals.appId || Config.Bifrost.whitelist.indexOf(path) >= 0) {
      return next()
    }

    res.locals.error = 'ERR_APP_NOT_FOUND'
    res.marko(Mystique.load('errors/appNotFound'))
  }

  validateModule (req, res, next) {
    if (res.locals.module) {
      return next()
    }

    res.locals.error = 'ERR_PAGE_NOT_FOUND'
    res.marko(Mystique.load('errors/pageNotFound'))
  }

  validateAccess (req, res, next) {
    let path = req.path
    if (typeof res.locals.module.route_path !== 'undefined') {
      path = res.locals.module.route_path
    }

    if (Config.Bifrost.whitelist.indexOf(path) >= 0) {
      return next()
    }

    if (res.locals.IAM) {
      if (res.locals.IAM.permission >= res.locals.module.permission) {
        return next()
      }
    }

    res.locals.error = 'ERR_ACCESS_FORBIDDEN'
    res.marko(Mystique.load('errors/forbidden'))
  }
}

module.exports = new Bifrost()
