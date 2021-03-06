 //Include the cluster module
var cluster = require('cluster');

// Code to run if we're in the master process
if (cluster.isMaster) {
  // Count the machine's CPU cores
  var cpuCount = require('os').cpus().length - 1;

  // Create a worker for each cpu core - 1
  for (var i = 0, il=cpuCount; i < il; i++) {
    cluster.fork();
  }

  // Listen for dying workers
  cluster.on('exit', function (worker) {
    // Replace the dead worker, we're not sentimental
    console.log('Worker ' + worker.id + ' died');

    cluster.fork();
  });

} else {
  //Imports
  var config = require('./config');
  var restify = require('restify');
  var mongode = require('mongode');
  var ObjectID = require('mongode').ObjectID;

  //Connect to database
  var db = mongode.connect(config.database.host + config.database.name);
  db.collection('plugins');
  db.collection('webstats');
  db.collection('geninfo');
  db.collection('authors');
  db.collection('categories');

  function setContentLength(res, length) {
    if (res.getHeader('Content-Length') === undefined && res.contentLength === undefined) {
      res.setHeader('Content-Length', length);
    }
  }

  function formatJSONP(req, res, body) {
    if (!body) {
      setContentLength(res, 0);
      return null;
    }

    if (body instanceof Error) {
      // snoop for RestError or HttpError, but don't rely on instanceof
      if ((body.restCode || body.httpCode) && body.body) {
        body = body.body;
      } else {
        body = {
          message: body.message
        };
      }
    }

    if (Buffer.isBuffer(body)) {
      body = body.toString('base64');
    }

    var callback = req.query.callback || req.query.jsonp;
    var data;

    if(callback) {
      data = callback + '(' + JSON.stringify(body) + ');';
    } else {
      data = JSON.stringify(body);
    }

    setContentLength(res, Buffer.byteLength(data));
    return data;
  }

  function jsonpParser(req, res, next) {
    if (req.query.callback || req.query.jsonp) {
      res.contentType = 'application/javascript'; 
    }

    next();
  }

  // Search Type Map
  var types = {
    '=': function (item, sub, reference) {
      reference[item['field']] = item['value'];
    },

    '!=': function (item, sub, reference) {
      reference[item['field']] = {
        '$ne': item['value']
      };
    },

    '<': function (item, sub, reference) {
      reference[item['field']] = {
        '$lt': item['value']
      };
    },

    '<=': function (item, sub, reference) {
      reference[item['field']] = {
        '$lte': item['value']
      };
    },

    '>': function (item, sub, reference) {
      reference[item['field']] = {
        '$gt': item['value']
      };
    },

    '>=': function (item, sub, reference) {
      reference[item['field']] = {
        '$gte': item['value']
      };
    },

    'like': function (item, sub, reference) {
      reference[item['field']] = new RegExp(item['value'], "i");
    },

    'exists': function (item, sub, reference) {
      reference[item['field']] = {
        '$exists': true
      };
    },

    'nexists': function (item, sub, reference) {
      reference[item['field']] = {
        '$exists': false
      };
    },

    'in': function (item, sub, reference) {
      if (item['value'].isArray()) {
        reference[item['field']] = {
          '$in': item['value']
        }
      }
    },

    'not in': function (item, sub, reference) {
      if (item['value'].isArray()) {
        reference[item['field']] = {
          '$nin': item['value']
        }
      }
    },

    'all': function (item, sub, reference) {
      if (item['value'].isArray()) {
        reference[item['field']] = {
          '$all': item['value']
        }
      }
    },

    'and': function (item, sub, reference) {
      if (item['value'].isArray() && item['field'] == '') {
        reference['$and'] = (item['value'] == null ? sub : item['value']);
      }
    },

    'or': function (item, sub, reference) {
      if (item['value'].isArray() && item['field'] == '') {
        reference['$or'] = (item['value'] == null ? sub : item['value']);
      }
    },

    'nor': function (item, sub, reference) {
      if (item['value'].isArray() && item['field'] == '') {
        reference['$nor'] = (item['value'] == null ? sub : item['value']);
      }
    },

    'not': function (item, sub, reference) {
      if (item['value'].isArray() && item['field'] == '') {
        reference['$not'] = (item['value'] == null ? sub : item['value']);
      }
    }
  };

  // Aliases
  types['equals'] = types['='];
  types['not-equals'] = types['!='];

  //Common methods
  var common = {
    fieldgen: function (fields, callback) {
      // Generates the field listing based on the include and exclude lists.
      var f = {
        '_id': 0
      }

      for (var i = 0, len = fields.length; i < len; i++) {
        if (fields[i] != '') {
          if (fields[i].charAt(0) == '-') {
            f[fields[i].substr(1)] = 0;
          } else {
            f[fields[i]] = 1;
          }
        }
      }

      callback(f);
    },

    list_geninfo: function (size, callback) {
      // Retrieves the last X number of generations based on the value of the size variable.
      if (size == undefined) {
        size = 1;
      }

      db.geninfo.find().sort('_id', -1).limit(size).toArray(function (err, docs) {
        for (var i in docs) {
          docs[i]['id'] = docs[i]['_id'];
          delete docs[i]['_id'];
        }

        callback(docs);
      });
    },

    get_geninfo: function (idnum, callback) {
      // Returns a specific generation ID's information.
      db.geninfo.findOne({
        '_id': ObjectID(idnum)
      }, function (err, document) {
        if (document != null) {
          document['id'] = document['_id'];
          document['_id'];
        }

        callback(document);
      })
    },

    query: function (filters, fields, sort, start, size, callback) {
      // Generic query function to centralize querying the database.
      var d = 1;

      if (sort.charAt(0) == '-') {
        sort = sort.substr(1);
        d = -1;
      }

      var the_fields = {};
      for (var i in fields) {
        the_fields[fields[i]] = 1;
      }

      the_fields['_id'] = 0;

      if (size != undefined) {
        if (start == undefined) {
          start = 0;
        }

        db.plugins.find(filters, the_fields).sort(sort, d).skip(start).limit(size).toArray(function (err, docs) {
          callback(docs);
        });
      } else {
        db.plugins.find(filters, the_fields).sort(sort, d).toArray(function (err, docs) {
          if (err || docs == null) {
            return callback(null);
          }

          callback(docs);
        });
      }
    },

    list_plugins: function (server, fields, sort, start, size, callback) {
      // Returns a list of plugins with the field specified, the list can be narrowed down to specific server binary compatability by setting it to other than undefined.
      var filters = {
        'deleted': {
          '$exists': false
        }
      };

      if (server != undefined) {
        filters['server'] = server
      }

      common.query(filters, fields, sort, start, size, function (the_callback) {
        callback(the_callback);
      })
    },

    list_author_plugins: function (server, author, fields, sort, start, size, callback) {
      // Returns the plugin list for a given author. Can be filtered by server binary compatability using the server variable.
      var filters = {
        'authors': author
      };

      if (server != undefined) {
        filters['server'] = server
      }

      common.query(filters, fields, sort, start, size, function (the_callback) {
        callback(the_callback)
      })
    },

    list_category_plugins: function (server, category, fields, sort, start, size, callback) {
      // Returns the plugin list for a given category. Can be filtered by server binary compatability using the server variable.
      var filters = {
        'categories': category
      };

      if (server != undefined) {
        filters['server'] = server
      }

      common.query(filters, fields, sort, start, size, function (the_callback) {
        callback(the_callback)
      })
    },

    ca_convert: function (data, callback) {
      // Reformats the data to what the API should be returning.
      var dset = [];
      var i = 0;
      var item;
      var dlen = data.length;

      for (; i < dlen; i++) {
        item = data[i];

        dset.push({
          'name': item['_id'],
          'count': item['value']
        });
      }

      return callback(dset);
    },

    list_authors: function (callback) {
      // Returns a list of plugin authors and the number of plugins each one has created/worked on.
      db.authors.find().sort('_id').toArray(function (err, docs) {
        common.ca_convert(docs, function (the_callback) {
          callback(the_callback);
        })
      })
    },

    list_categories: function (callback) {
      // Returns a list of plugin categories and the count of plugins that fall under each category.
      db.categories.find().sort('_id').toArray(function (err, docs) {
        common.ca_convert(docs, function (the_callback) {
          callback(the_callback);
        })
      })
    },

    plugin_details: function (server, plugin, version, fields, callback) {
      // Returns the plugin details for a given plugin. Optionally will also return a specific version of the plugin in the versions list if something other than undefined is specified in the version variable.
      var filters = {
        'slug': plugin,
        'server': server
      };

      if (version != undefined && (version == 'release' || version == 'alpha' || version == 'beta')) {
        filters['versions.type'] = (version.charAt(0).toUpperCase() + version.slice(1));

        if (fields != null && fields.length != 0) {
          fields.append('versions.type');
        }
      }

      common.fieldgen(fields, function (callback) {
        fields = callback;
      });

      db.plugins.findOne(filters, fields, function (err, p) {
        if (err || p == null) {
          return callback(null);
        }

        var i;
        var found;
        var versionsLen;

        if (version != undefined && p['versions'] != null) {
          if (version.toLowerCase() == "latest") {
            p['versions'] = [p['versions'][0]];
          } else if (version.toLowerCase() == "alpha" || version.toLowerCase() == "beta" || version.toLowerCase() == "release") {
            i = 0;
            found = false;
            versionsLen = p['versions'].length;

            for (; i < versionsLen; i++) {
              if (p['versions'][i]['type'].toLowerCase() == version.toLowerCase()) {
                p['versions'] = [p['versions'][i]];
                found = true;
              }
            }

            if (!found) {
              p['versions'] = [];
            }
          } else {
            i = 0;
            found = false;
            versionsLen = p['versions'].length;

            for (; i < versionsLen; i++) {
              if (p['versions'][i]['version'] == version) {
                p['versions'] = [p['versions'][i]];
                found = true;
              }
            }

            if (!found) {
              p['versions'] = [];
            }
          }
        }

        callback(p);
      });
    },

    plugins_up_to_date: function (plugins_list, server, callback) {
      // Takes a list of plugin slugs and returns an array of objects with the plugin and most recent version.
      var data = [];
      var slugs = [];

      for (var i = 0; i < plugins_list.length; i++) {
        slugs.push({
          'slug': plugins_list[i]
        });
      }

      db.plugins.find({
        '$or': slugs,
        'server': server
      }).toArray(function (err, docs) {
        var i = 0, doc, docLen = docs.length;
        var x, versions, version, versionLen;

        for (; i < docLen; i++) {
          doc = docs[i];
          versions = doc['versions'];

          var entry = {
            'slug': doc['slug'],
            'plugin_name': doc['plugin_name'],
            'versions': {
              'latest': versions[0]['version']
            },
          }

          x = 0;
          versionLen = versions.length;

          for (; x < versionLen; x++) {
            version = versions[x];

            if (version['type'] == 'Release' || version['type'] == 'Beta' || version['type'] == 'Alpha') {
              if (entry['versions'][version['type'].toLowerCase()] == null) {
                entry['versions'][version['type'].toLowerCase()] = version['version'];
              }
            }
          }

          data.push(entry);
        }

        callback(data);
      })
    },

    plugin_search: function (filters, fields, sort, start, size, sub, callback) {
      // A generalized sort function for the database. 
      // Returns a list of plugins with the fields specified in the inclusion and exclusion variables.
      
      var f = {};
      var i = 0;
      var item;
      var action;
      var filterLen = filters.length;

      if (sub == undefined) {
        sub = false;
      }

      for (; i < filterLen; i++) {
        item = filters[i];
        action = item['action'];

        if (types[action]) {
          types[action](item, sub, f);
        }

        if (sub) {
          return callback(f);
        }

        common.query(f, fields, sort, start, size, function (the_callback) {
          callback(the_callback);
        });
      }
    }
  };

  //Initialize express app
  var app = restify.createServer({
    formatters: {
    'application/javascript': formatJSONP
    }
  });

  app.pre(restify.pre.userAgentConnection());
  app.pre(restify.pre.sanitizePath());

  //Middlewares
  app.use(jsonpParser);

  app.use(function (req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    next();
  });

  app.use(restify.queryParser());
  app.use(restify.bodyParser())

  //Include api handlers
  require('./v3')(app, db, common);

  //Redirect
  app.get('/', function(req, res) {
    res.header('Location', '/3');
    res.send(302);
  });

  //Handle stats requests
  app.get('/stats/naughty_list', function (req, res, next) {
    db.plugins.find({ '_use_dbo': { '$exists': true } }, {
      '_id': 0,
      'slug': 1,
      'plugin_name': 1,
      'authors': 1,
    }).toArray(function (err, docs) {
      if (err) {
        res.send(500);
        return next();
      }

      res.send(docs);
      return next();
    });
  });

  app.get('/stats/todays_trends', function (req, res, next) {
    db.plugins.find({}, {
      'slug': 1,
      'versions.version': 1
    }).toArray(function (err, plugins) {
      if (err) {
        res.send(500);
        return next();
      }

      var pcount = plugins.length;
      var vcount = 0;

      for (plugin in plugins) {
        vcount += plugins[plugin]['versions'].length;
      }

      res.send({
        'plugin_count': pcount,
        'version_count': vcount
      });

      return next();
    });
  });

  app.get('/stats/trend/:days', function (req, res, next) {
    db.webstats.find({}, {
      '_id': 0,
      'plugins': 0
    }).sort('_id', -1).limit(parseInt(req.params.days)).toArray(function (err, docs) {
      if (err) {
        res.send(500);
        return next();
      }

      res.send(docs);
      return next();
    });
  });

  app.get('/stats/trend/:days/:names', function (req, res, next) {
    var fields = {
      '_id': 0,
      'timestamp': 1
    }

    var plugins = req.params.names.split(',');
    var index = 0;

    for (index; index < plugins.length; index++) {
      fields['plugins.' + plugins[index]] = 1;
    }

    db.webstats.find({}, fields).sort('_id', -1).limit(parseInt(req.params.days)).toArray(function (err, docs) {
      if (err) {
        res.send(500);
        return next();
      }

      res.send(docs);
      return next();
    });
  });

  //Deprecation stuff
  app.get('/2/bukkit/plugins', function (req, res, next) {
     res.send(['API', 'Deprecated', 'Please', 'update', 'your', 'software']);
  });

  app.get('/2/authors', function (req, res, next) {
    res.send(['API', 'Deprecated', 'Please', 'update', 'your', 'software']);
  });

  app.get('/2/categories', function (req, res, next) {
    res.send(['API', 'Deprecated', 'Please', 'update', 'your', 'software']);
  });

  app.get('/api2/bukkit/plugins', function (req, res, next) {
     res.send(['API', 'Deprecated', 'Please', 'update', 'your', 'software']);
  });

  app.get('/api2/authors', function (req, res, next) {
    res.send(['API', 'Deprecated', 'Please', 'update', 'your', 'software']);
  });

  app.get('/api2/categories', function (req, res, next) {
    res.send(['API', 'Deprecated', 'Please', 'update', 'your', 'software']);
  });

  //Start webserver
  app.listen(config.port, config.address);

  console.log('Worker ' + cluster.worker.id + ' running!');
}