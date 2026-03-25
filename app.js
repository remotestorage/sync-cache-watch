const rid = () => Math.random().toString(36).slice(2);
function yamlify (obj, indent = 0) {
  const spaces = ' '.repeat(indent);
  const size = 2;

  if (obj === null)
    return 'null';
  
  if (typeof obj !== 'object')
    return JSON.stringify(obj);
  
  if (Array.isArray(obj))
    return obj.map(item => `${ spaces }--- \n${ yamlify(item, indent + size) }`).join('\n');

  return Object.entries(obj).map(([key, val]) => {
    const _key = `${ spaces }${ key }:`;
    
    if (typeof val === 'object' && val !== null)
      return `${ _key }\n${ yamlify(val, indent + size) }`;
    
    return `${ _key } ${ JSON.stringify(val) }`;
  }).join('\n');
};

// remoteStorage module
const crud = {
  name: 'crud',
  builder (privateClient) {
    privateClient.declareType('crud-item', {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    });

    return {
      exports: {
        cacheItems: () => privateClient.cache(''),

        handle: privateClient.on,

        addItem: object => privateClient.storeObject('crud-item', `${ rid() }/${ rid() }`, object),

        getItem: path => privateClient.getObject(path),

        removeItem: privateClient.remove.bind(privateClient),

        getAllItems: () => privateClient.getAll('', false),
      },
    };
  },
};

// remoteStorage api
const api = new RemoteStorage({
  modules: [crud],
  logging: true,
  changeEvents: { local: true, window: true, remote: true, conflict: true },
});

api.access.claim('crud', 'rw');

api.crud.cacheItems();

// remoteStorage events
api.crud.handle('change', event => {
  view.renderDB();

  if (event.newValue && !event.oldValue)
    return console.info(`Change from ${ event.origin } (add)`, event) || view.renderItem(event.relativePath, event.newValue);

  if (!event.newValue && event.oldValue)
    return console.info(`Change from ${ event.origin } (remove)`, event) || view.unrenderItem(event.relativePath);

  if (event.newValue && event.oldValue) {
    console.info(`Change from ${ event.origin } (change)`, event);

    if (event.origin !== 'conflict')
      return view.renderItems();

    return api.crud.updateItem(event.relativePath, Object.assign(event.newValue, {
      name: `${ event.oldValue.name } / ${ event.newValue.name } (was ${ event.lastCommonValue.name })`,
    })).then(view.renderItems);
  }

  console.info(`Change from ${ event.origin }`, event);
});

// interface
const view = {

  renderDB: () => Object.assign(indexedDB.open('remotestorage'), {
    onsuccess (event) {
      const db = event.target.result;
      const allData = [];

      const transaction = db.transaction(db.objectStoreNames, 'readonly');
      const req = transaction.objectStore('nodes').getAll();
      req.onsuccess = () => view._renderDB(req.result);
    },
    onerror: view._renderDB,
  }),

  _renderDB: input => document.querySelector('pre').innerHTML = yamlify(input, null, ' '),

  renderItems: () => api.crud.getAllItems().then(items => {
    document.querySelector('ul').innerHTML = '';

    Object.entries(items).forEach(([parent, value]) => {
      Object.entries(value).forEach(([child, value]) => {
        if (!value)
          return

        const id = parent + child;
        api.crud.getItem(id).then(object => view.renderItem(id, object))
      });
    });
  }),

  _li: id => document.querySelector(`li[data-id="${ id }"]`),

  renderItem (id, object) {
    let li = view._li(id);

    if (!li) {
      li = document.createElement('li');
      li.dataset.id = id;
      document.querySelector('ul').appendChild(li);
    }

    li.innerHTML += `<span style="opacity: 0.5">${ id }</span> ${ object.name } <button class="destructive">delete</button>`;
    
    li.querySelector('button').onclick = event => {
      event.preventDefault();

      api.crud.removeItem(li.dataset.id);
    };
  },

  unrenderItem: (id) => document.querySelector('ul').removeChild(view._li(id)),

  emptyItems () {
    document.querySelector('ul').innerHTML = '';
    document.querySelector('#add-item input').value = '';
  },

};

// setup after page loads
document.addEventListener('DOMContentLoaded', () => {
  (new Widget(api)).attach(document.querySelector('widget-wrapper'));

  api.on('ready', () => {
    document.getElementById('add').onclick = event => {
      event.preventDefault();

      api.crud.addItem({ name: rid() });
    };

    document.getElementById('direct').onclick = event => {
      event.preventDefault();

      view.renderItems();
    };

    document.getElementById('reset').onclick = event => {
      event.preventDefault();

      Object.assign(indexedDB.open('remotestorage'), {
        onsuccess (event) {
          const db = event.target.result;
          const tx = db.transaction('nodes', 'readwrite');
          const store = tx.objectStore('nodes');
          const clearReq = store.clear();

          clearReq.onsuccess = () => view._renderDB('All records cleared. Reload to fetch again.');
          clearReq.onerror = view._renderDB;

          tx.oncomplete = () => db.close();

          view.emptyItems();
        },
        onerror: view._renderDB,
      });
    };

    view.renderDB();
  });

  api.on('disconnected', view.emptyItems);  
});
