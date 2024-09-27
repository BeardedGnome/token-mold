import { TokenMoldForm } from "./token-mold-form.js";
import { TokenMoldOverlay } from "./token-mold-overlay.js";

export default class TokenMold {
  static MODULEID = "token-mold";
  static LOG_LEVEL = Object.freeze({
    Debug: 0,
    Info: 1,
    Warn: 2,
    Error: 3,
  });
  static CURRENT_LOG_LEVEL = TokenMold.LOG_LEVEL.Info;

  static SUPPORTED_SYSTEMS = ["dnd5e", "pf2e", "sfrpg", "sw5e", "dcc"];
  static SUPPORTED_ROLLHP = ["dnd5e", "sw5e", "dcc"];
  static SUPPORTED_CREATURESIZE = ["dnd5e", "pf2e"];
  static SUPPORTED_5ESKILLS = ["dnd5e", "sw5e"];

  constructor() {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "TokenMold");
    this.counter = {};
    this._rollTableList = {};
    this.dict = null;

    this.initHooks();
  }

  /**
   *
   * @param {object} level
   * @param  {...any} args
   *
   * @returns {void}
   */
  static log(level, ...args) {
    // NOTE: Developer Mode doesn't work in Foundry v12
    const shouldLog =
      level >= TokenMold.CURRENT_LOG_LEVEL ||
      game.modules
        .get("_dev-mode")
        ?.api?.getPackageDebugValue(TokenMold.MODULEID);

    if (shouldLog) {
      switch (level) {
        case TokenMold.LOG_LEVEL.Error:
          console.error("Token Mold", "|", ...args);
          break;
        case TokenMold.LOG_LEVEL.Warn:
          console.warn("Token Mold", "|", ...args);
          break;
        case TokenMold.LOG_LEVEL.Info:
          console.info("Token Mold", "|", ...args);
          break;
        case TokenMold.LOG_LEVEL.Debug:
        default:
          console.debug("Token Mold", "|", ...args);
          break;
      }
    }
  }

  /**
   *
   */
  initHooks() {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "initHooks");

    // params: Application, jQuery, object
    Hooks.on("renderActorDirectory", (app, html, data) => {
      if (game.user.isGM) {
        this._hookActorDirectory(html);
      }
    });

    this.systemSupported = TokenMold.SUPPORTED_SYSTEMS.includes(game.system.id);

    this.registerSettings();
    this.loadSettings();

    // params: PlaceableObject, boolean
    Hooks.on("hoverToken", (token, hovered) => {
      if (!token || !token.actor) {
        return;
      }

      // Don't show for permission lvl lower than observer
      if (token.actor.permission < CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) {
        return;
      }

      if (canvas.hud.TokenMold === undefined || this.settings.overlay.attrs.length === 0 || (token.document.actorLink && !this.settings.enableOverlayForLinked)) {
        return;
      }

      if (hovered && this.settings.overlay.use === true) {
        canvas.hud.TokenMold.attrs = this.settings.overlay.attrs;
        canvas.hud.TokenMold.bind(token);
      } else {
        canvas.hud.TokenMold.clear();
      }
    });

    Hooks.once("ready", async () => {
      // params: Application, jQuery, object
      Hooks.on("renderHeadsUpDisplay", (app, html, data) => {
        html.append('<template id="token-mold-overlay"></template>');
        canvas.hud.TokenMold = new TokenMoldOverlay();
      });

      if (!game.user.isGM) {
        return;
      }

      // params: Document, DatabaseDeleteOperation, string
      Hooks.on("deleteToken", (token, options, userId) => {
        if (!canvas.hud.TokenMold) return;
        canvas.hud.TokenMold.clear();
      });

      // params: Document, object, DatabaseCreateOperation, string
      Hooks.on("preCreateToken", (token, data, options, userId) => {
        const scene = token.parent;
        const newData = this._setTokenData(scene, data);
        TokenMold.log(TokenMold.LOG_LEVEL.Debug, "preCreateToken", token, data, newData, );
        token.updateSource(newData);
      });

      // params: Document, DatabaseCreateOperation, string
      Hooks.on("createToken", (token, options, userId) => {
        if (userId !== game.userId) {
          // filter to single user
          return;
        }
        TokenMold.log(TokenMold.LOG_LEVEL.Debug, "createToken", token, );
        this._setHP(token);
      });

      this.barAttributes = await this._getBarAttributes();
      await this._loadDicts();

      await this._getRolltables();

      await this._loadTable();
    });
  }

  /**
   *
   * @returns {string[]}
   */
  get languages() {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "languages");
    return [
      "afrikaans",
      "albanian",
      "armenian",
      "azeri",
      "croatian",
      "czech",
      "danish",
      "dutch",
      "english",
      "estonian",
      "finnish",
      "french",
      "georgian",
      "german",
      "greek",
      "hungarian",
      "icelandic",
      "indonesian",
      "irish",
      "italian",
      "latvian",
      "lithuanian",
      "norwegian",
      "polish",
      "portuguese",
      "romanian",
      "russian",
      "sicilian",
      "slovak",
      "slovenian",
      "spanish",
      "swedish",
      "turkish",
      "welsh",
      "zulu",
    ];
  }

  /**
   * Only loads dicts if the option is set *and* they're not already loaded
   * possible TODO: maybe check if dict is needed?
   *
   * @returns {Promise<any>}
   */
  async _loadDicts() {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_loadDicts");
    // Remove if replace is unset
    if (!game.user || !game.user.isGM || this.settings.name.replace !== "replace") {
      // Useful to free up memory? its "just" up to 17MB...
      // delete this.dict;
      return;
    }
    if (!this.dict) {
      this.dict = {};
    }
    let languages = this.languages;
    for (let lang of languages) {
      if (this.dict[lang]) {
        continue;
      }
      this.dict[lang] = (await import(`./dict/${lang}.js`)).lang;
    }
  }

  /**
   *
   * @returns {Promise<any>}
   */
  async _loadTable() {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_loadTable");
    let document;
    try {
      document = await fromUuid(this.settings.name.prefix.table);
    } catch (error) {
      // Reset if table not found..
      document = await fromUuid(this.defaultSettings().name.prefix.table);
      this.settings.name.prefix.table = this.defaultSettings().name.prefix.table;
    }

    this.adjectives = document;
  }

  /**
   * Gets a list of all Rollable Tables available to choose adjectives from.
   *
   * @returns {Promise<any>}
   */
  async _getRolltables() {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_getRolltables");
    const rollTablePacks = game.packs.filter((e) => e.documentName === "RollTable", );

    this._rollTableList = {};
    if (game.tables.size > 0) {
      this._rollTableList["World"] = [];
    }
    for (const table of game.tables) {
      this._rollTableList["World"].push({
        name: table.name,
        uuid: `RollTable.${table.id}`,
      });
    }
    for (const pack of rollTablePacks) {
      this._rollTableList[pack.metadata.label] = [];
      for (let table of pack.index) {
        this._rollTableList[pack.metadata.label].push({
          name: table.name,
          uuid: table.uuid,
        });
      }
    }
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "Rollable Tables found", this._rollTableList,);
  }

  /**
   *
   * @param {jQuery}  html
   *
   * @return {Promise<any>}
   */
  async _hookActorDirectory(html) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_hookActorDirectory");
    this.section = document.createElement("section");
    this.section.classList.add("token-mold");
    // Add menu before directory header
    const dirHeader = html[0].querySelector(".directory-header");
    dirHeader.parentNode.insertBefore(this.section, dirHeader);

    if (this.data !== undefined) {
      this._renderActorDirectoryMenu();
    }
  }

  /**
   *
   * @returns {Promise<any>}
   */
  async _renderActorDirectoryMenu() {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_renderActorDirectoryMenu");
    const section = this.section;
    section.insertAdjacentHTML(
      "afterbegin",
      `
        <h3>Token Mold</h3>
        <label class='label-inp' title='(De-)activate Name randomizing'>
            <input class='name rollable' type='checkbox' name='name.use' ${this.settings.name.use ? "checked" : ""}><span><span class='checkmark'></span>&nbsp;Name</span>
        </label>
        ${
          TokenMold.SUPPORTED_ROLLHP.includes(game.system.id)
            ? `
        <label class='label-inp' title='(De-)activate Hit Point rolling'>
            <input class='hp rollable' type='checkbox' name='hp.use' ${this.settings.hp.use ? "checked" : ""}><span><span class='checkmark'></span>&nbsp;HP</span>
        </label>`
            : ``
        }
        <label class='label-inp' title='(De-)activate Token Config Overwrite'>
            <input class='config rollable' type='checkbox' name='config.use' ${this.settings.config.use ? "checked" : ""}><span><span class='checkmark'></span>&nbsp;Config</span>
        </label>
        <label class='label-inp' title='(De-)activate Stat Overlay On Hover'>
            <input class='config rollable' type='checkbox' name='overlay.use' ${this.settings.overlay.use ? "checked" : ""}><span><span class='checkmark'></span>&nbsp;Overlay</span>
        </label>

        <a class='refresh-selected' title="Reapplies all settings to selected tokens as if those were replaced onto the scene."><i class="fas fa-sync-alt"></i></a>
        <a class='token-rand-form-btn' title='Settings'><i class="fa fa-cog"></i></a>
        <h2></h2>
      `,
    );

    const inputs = section.querySelectorAll('input[type="checkbox"]');
    for (let checkbox of inputs) {
      checkbox.addEventListener("change", (ev) => {
        foundry.utils.setProperty(this.data, ev.target.name, ev.target.checked);
        this.saveSettings();
      });
    }

    this.section
      .querySelector(".refresh-selected")
      .addEventListener("click", (ev) => this._refreshSelected());
    this.section
      .querySelector(".token-rand-form-btn")
      .addEventListener("click", (ev) => {
        if (this.form === undefined) {
          this.form = new TokenMoldForm(this);
        } else {
          this.form.data = this.data;
        }
        this.form.render(true);
      });
  }

  /**
   * Always update all checkboxes present. For two reasons:
   *  - Other connected user  changes smth, so we have to update our view as well
   *  - Popout sidebar needs to update on change as well
   *
   * @returns {void}
   */
  _updateCheckboxes() {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_updateCheckboxes");
    const inputs = document.querySelectorAll("section.token-mold input");
    inputs.forEach((el) => {
      const name = el.name;
      el.checked = foundry.utils.getProperty(this.data, name);
    });
  }

  /**
   *
   * @param {Scene}   scene
   * @param {object}  data  Represents TokenData
   *
   * @return {object}
   */
  _setTokenData(scene, data) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_setTokenData");
    const actor = game.actors.get(data.actorId);
    const newData = { _id: data._id };

    if (!actor || (data.actorLink && this.settings.unlinkedOnly)) {
      // Don't for linked token
      return newData;
    }

    // Do this for all tokens, even player created ones
    if (this.settings.size.use && TokenMold.SUPPORTED_CREATURESIZE.includes(game.system.id)) {
      this._setCreatureSize(newData, actor, scene);
    }

    if (this.counter[scene.id] === undefined) {
      this.counter[scene.id] = {};
    }

    if (this.settings.name.use) {
      const newName = this._modifyName(data, actor, scene);
      newData.name = newName;
    }

    if (this.settings.config.use) {
      this._overwriteConfig(newData, actor);
    }

    return newData;
  }

  /**
   *
   * @param {TokenDocument} token
   *
   * @returns {Promise<any>}
   */
  async _setHP(token) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_setHP");

    if (!token.actor || (token.actorLink && this.settings.unlinkedOnly)) {
      // Don't for linked token
      return;
    }

    if (TokenMold.SUPPORTED_ROLLHP.includes(game.system.id)) {
      if (this.settings.hp.use) {
        const val = await this._rollHP(token);
        token.actor.update({'system.attributes.hp': {value: val, max: val}});
      }
    }
  }

  /**
   * Probably not required, but I implemented it before I understood
   *
   * @param {TokenDocument} token
   * @param {object}        data
   *
   * @returns {Promise<any>}
   */
  async _setDeltaHP(token, data) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_setDeltaHP");

    if (!token.actor || (token.actorLink && this.settings.unlinkedOnly)) {
      // Don't for linked token
      return;
    }

    if (TokenMold.SUPPORTED_ROLLHP.includes(game.system.id)) {
      if (this.settings.hp.use) {
        // TODO Delete this method
        const val = await this._rollHP(token);
        foundry.utils.setProperty(data, "delta.system.attributes.hp.value", val);
        foundry.utils.setProperty(data, "delta.system.attributes.hp.max", val);
      }
    }
  }

  /**
   *
   * @returns {Promise<Document[]>}
   */
  async _refreshSelected() {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_refreshSelected");
    const selected = canvas.tokens.controlled;
    let udata = [];
    for (const token of selected) {
      const newData = this._setTokenData(canvas.scene, token.document.toObject());

      await this._setDeltaHP(token.document, newData);

      udata.push(newData);
    }

    canvas.scene.updateEmbeddedDocuments("Token", udata);
  }

  /**
   *
   * @param {TokenData} data
   * @param {Actor}     actor
   *
   * @returns {void}
   */
  _overwriteConfig(data, actor) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_overwriteConfig");
    for (let [key, value] of Object.entries(this.settings.config)) {
      if (value.use !== true) {
        continue;
      }
      if (value.value !== undefined) {
        data[key] = value.value;
      } else if (value.min !== undefined && value.max !== undefined) {
        let val = data[key] || 1;
        data[key] = (val * Math.floor((Math.random() * (value.max - value.min) + value.min) * 100, )) / 100;
      } else if (value.attribute !== undefined && (value.attribute === "" || foundry.utils.getProperty(actor, value.attribute) !== undefined) ) {
        data[key].attribute = value.attribute;
      } else if ( value.attribute === undefined && value.min === undefined && value.max === undefined && value.value === undefined ) {
        // Random mirroring
        data[key] = Boolean(Math.round(Math.random()));
      }
    }
  }

  /**
   *
   * @param {TokenDocument} token
   *
   * @returns {Promise<any>}
   */
  async _rollHP(token) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_rollHP");
    const hpProperties = {
      dnd5e: "system.attributes.hp.formula",
      sw5e: "system.attributes.hp.formula",
      dcc: "system.attributes.hitDice.value",
    };

    const formula = foundry.utils.getProperty(token.actor, hpProperties[game.system.id]);
    if (formula) {
      TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_rollHP.formula", formula );

      const constant = new Roll(formula.replace(" ", ""));
      constant.evaluateSync({strict: false}); // calculate the constant portion
      TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_rollHP.constant.evaluateSync.total", constant.total );

      const roll = new Roll(formula.replace(" ", ""));
      await roll.evaluate();
      TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_rollHP.roll.evaluate.total", roll.total );

      if (this.settings.hp.toChat) {
        roll.toMessage({
          rollMode: "gmroll",
          flavor: token.name + " rolls for hp!",
        });
      }
      // Make sure hp is at least 1 or the number of dice + constant value
      const min = Math.max(roll.dice[0].number + constant.total, 1);
      TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_rollHP.min", min );
      const val = Math.max(roll.total, min);

      return val;
    } else {
      ui.notifications.warn("Can not randomize hp. HP formula is not set.");
      return foundry.utils.getProperty(token.actor, "system.attributes.hp.value");
    }
  }

  /**
   *
   * @param {TokenData} data
   * @param {Actor}     actor
   * @param {Scene}     scene
   *
   * @return {void}
   */
  _modifyName(data, actor, scene) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_modifyName");
    //let name = actor.prototypeToken.name; // from base actor data
    let name = data.name; // from TokenData

    if (["remove", "replace"].includes(this.settings.name.replace) && !(this.settings.name.baseNameOverride && event.getModifierState("Shift"))) {
      name = "";
    }

    let numberSuffix = "";
    if (this.settings.name.number.use) {
      let number = 0;
      // Check if number in session database
      if (this.counter[scene.id][data.actorId] !== undefined) {
        number = this.counter[scene.id][data.actorId];
      } else {
        // Extract number from last created token with the same actor ID
        const sameTokens =
          scene.tokens.filter((e) => e.actorId === data.actorId) || [];
        if (sameTokens.length !== 0) {
          const lastTokenName = sameTokens[sameTokens.length - 1].name;
          // Split by prefix and take last element
          let tmp = lastTokenName.split(this.settings.name.number.prefix).pop();
          if (tmp !== "") {
            // Split by suffix and take first element
            number = tmp.split(this.settings.name.number.suffix)[0];
          }
        }
      }
      // Convert String back to number
      switch (this.settings.name.number.type) {
        case "ar":
          number = parseInt(number);
          break;
        case "alu":
          number = this._dealphabetize(number.toString(), "upper");
          break;
        case "all":
          number = this._dealphabetize(number.toString(), "lower");
          break;
        case "ro":
          number = this._deromanize(number);
          break;
      }
      // If result is no number, set to zero
      if (isNaN(number)) {
        number = 0;
      } else {
        // count upwards
        if (this.settings.name.number.range > 1) {
          number += Math.ceil(Math.random() * this.settings.name.number.range);
        } else {
          number++;
        }
      }

      switch (this.settings.name.number.type) {
        case "alu":
          number = this._alphabetize(number, "upper");
          break;
        case "all":
          number = this._alphabetize(number, "lower");
          break;
        case "ro":
          number = this._romanize(number);
          break;
      }

      this.counter[scene.id][data.actorId] = number;

      numberSuffix =
        this.settings.name.number.prefix + number + this.settings.name.number.suffix;
    }

    if (this.settings.name.replace === "replace") {
      name = this._pickNewName(actor) + " " + name;
    }

    if (this.settings.name.prefix.use) {
      const adj =
        this.adjectives.results._source[
          Math.floor(this.adjectives.results.size * Math.random())
        ].text;
      if (this.settings.name.prefix.position === "back") {
        name = name + " " + adj;
      } else {
        name = adj + " " + name;
      }
    }

    name += numberSuffix;

    return name;
  }

  /**
   *
   * @param {object} items
   *
   * @returns {string}
   */
  _chooseWeighted(items) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_chooseWeighted");
    var keys = Object.keys(items);
    var vals = Object.values(items);
    var sum = vals.reduce((accum, elem) => accum + elem, 0);
    var accum = 0;
    vals = vals.map((elem) => (accum = elem + accum));
    var rand = Math.random() * sum;
    return keys[vals.filter((elem) => elem <= rand).length];
  }

  /**
   *
   * @param {string} txt
   * @param {string} fromCase
   * @param {string} toCase
   *
   * @returns {string}
   */
  _chgCase(txt, fromCase, toCase) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_chgCase");
    var res = "";
    var c = "";
    for (c of txt) {
      let loc = fromCase.indexOf(c);
      if (loc < 0) {
        res = res + c;
      } else {
        res = res + toCase[loc];
      }
    }
    return res;
  }

  /**
   * Thanks for 'trdischat' for providing this awesome name generation algorithm!
   * Base idea:
   *  - Choose a language (depending on settings chosen)
   *  - Choose a random starting trigram for the language, weighted by frequency used
   *  - Go on choosing letters like before, using the previous found letter as starting letter of the trigram, until maximum is reached
   *
   * @param {Actor} actor
   *
   * @return {string}
   */
  _pickNewName(actor) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_pickNewName");
    const attributes = this.settings.name.options.attributes || [];

    let lang;
    for (let attribute of attributes) {
      const langs = attribute.languages;
      const val = String(foundry.utils.getProperty(actor.system, attribute.attribute), ).toLowerCase();

      lang = langs[val];

      if (lang !== undefined) {
        break;
      }
    }

    if (lang === undefined) {
      lang = this.settings.name.options.default;
    }

    if (lang === "random") {
      const keys = Object.keys(this.dict);
      lang = keys[Math.floor(Math.random() * keys.length)];
    }

    const minNameLen = this.settings.name.options.min || 6;
    const maxNameLen = this.settings.name.options.max || 9;

    const nameLength =
      Math.floor(Math.random() * (maxNameLen - minNameLen + 1)) + minNameLen;
    let newName = this._chooseWeighted(this.dict[lang].beg);
    const ltrs = (x, y, b) =>
      x in b && y in b[x] && Object.keys(b[x][y]).length > 0 ? b[x][y] : false;

    for (let i = 4; i <= nameLength; i++) {
      const c1 = newName.slice(-2, -1);
      const c2 = newName.slice(-1);
      const br = i == nameLength ? this.dict[lang].end : this.dict[lang].mid;
      const c3 = ltrs(c1, c2, br) || ltrs(c1, c2, this.dict[lang].all) || {};
      if (c1 == c2 && c1 in c3) {
        delete c3[c1];
      }
      if (Object.keys(c3).length == 0) {
        break;
      }
      newName = newName + this._chooseWeighted(c3);
    }

    newName = newName[0] + this._chgCase(newName.slice(1), this.dict[lang].upper, this.dict[lang].lower, );
    return newName;
  }

  /**
   *
   * @param {string} num
   * @param {string} letterStyle
   *
   * @return {number}
   */
  _dealphabetize(num, letterStyle) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_dealphabetize");
    if (num === "0") {
      return 0;
    }
    let ret = 0;
    const startValue = {
      upper: 64,
      lower: 96,
    }[letterStyle];

    for (const char of num) {
      ret += char.charCodeAt(0) - startValue;
    }

    return ret;
  }

  /**
   *
   * @param {number} num
   * @param {string} letterStyle
   *
   * @return {string}
   */
  _alphabetize(num, letterStyle) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_alphabetize");
    let ret = "";

    const startValue = {
      upper: 64,
      lower: 96,
    }[letterStyle];

    while (num >= 26) {
      ret += String.fromCharCode(startValue + 26);
      num -= 26;
    }

    ret += String.fromCharCode(startValue + num);

    return ret;
  }

  /**
   * Romanizes a number, code is from : http://blog.stevenlevithan.com/archives/javascript-roman-numeral-converter
   *
   * @param {number} num
   *
   * @return {string}
   */
  _romanize(num) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_romanize");
    if (!+num) {
      return false;
    }
    var digits = String(+num).split(""),
      key = [
        "",
        "C",
        "CC",
        "CCC",
        "CD",
        "D",
        "DC",
        "DCC",
        "DCCC",
        "CM",
        "",
        "X",
        "XX",
        "XXX",
        "XL",
        "L",
        "LX",
        "LXX",
        "LXXX",
        "XC",
        "",
        "I",
        "II",
        "III",
        "IV",
        "V",
        "VI",
        "VII",
        "VIII",
        "IX",
      ],
      roman = "",
      i = 3;
    while (i--) {
      roman = (key[+digits.pop() + (i * 10)] || "") + roman;
    }
    return Array(+digits.join("") + 1).join("M") + roman;
  }

  /**
   * code is from : http://blog.stevenlevithan.com/archives/javascript-roman-numeral-converter
   *
   * @param {string} rom
   *
   * @return {number}
   */
  _deromanize(rom) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_deromanize");
    if (typeof rom !== "string") {
      return 0;
    }
    let str = rom.toUpperCase(),
      validator = /^M*(?:D?C{0,3}|C[MD])(?:L?X{0,3}|X[CL])(?:V?I{0,3}|I[XV])$/,
      token = /[MDLV]|C[MD]?|X[CL]?|I[XV]?/g,
      key = {
        M: 1000,
        CM: 900,
        D: 500,
        CD: 400,
        C: 100,
        XC: 90,
        L: 50,
        XL: 40,
        X: 10,
        IX: 9,
        V: 5,
        IV: 4,
        I: 1,
      },
      num = 0,
      m;
    if (!(str && validator.test(str))) {
      return false;
    }
    while ((m = token.exec(str))) {
      num += key[m[0]];
    }
    return num;
  }


  /**
   * Scale tokens according to set creature size
   * DnD 5e and PF2e only
   *
   * @param {object}    newData
   * @param {Actor}     actor
   * @param {Scene}     scene
   *
   * @return {void}
   */
  _setCreatureSize(newData, actor, scene) {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_setCreatureSize");
    const sizes = {
      tiny: 0.5,
      sm: 0.8,
      med: 1,
      lg: 2,
      huge: 3,
      grg: 4,
    };
    const aSize = actor.system.traits.size;
    let tSize = sizes[aSize];

    // if size could not be found return
    if (tSize === undefined) {
      return;
    }

    // If scene has feet/ft as unit, scale accordingly
    //  5 ft => normal size
    // 10 ft => double
    // etc.
    if (scene.grid.type && /(ft)|eet/.exec(scene.grid.units) !== null) {
      tSize *= 5 / scene.grid.distance;
    }

    if (tSize < 1) {
      newData["texture.scaleX"] = newData["texture.scaleY"] =
        tSize < 0.2 ? 0.2 : Math.floor(tSize * 10) / 10;
      newData["width"] = newData["height"] = 1;
    } else {
      const int = Math.floor(tSize);

      // Make sure to only have integers
      newData["width"] = newData["height"] = int;
      // And scale accordingly
      tSize = Math.max(tSize / int, 0.2);
      newData["texture.scaleX"] = newData["texture.scaleY"] = tSize;
    }
  }

  /**
   *
   * @return {void}
   */
  registerSettings() {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "registerSettings");
    // register settings
    game.settings.register("Token-Mold", "everyone", {
      name: "Token Mold Settings",
      hint: "Settings definitions for the Token Mold Module",
      default: this.defaultSettings(),
      type: Object,
      scope: "world",
      onChange: (data) => {
        this.data = data;
        this._updateCheckboxes();
      },
    });
  }

  /**
   *
   * @return {object}
   */
  defaultSettings() {
    TokenMold.log(TokenMold.LOG_LEVEL.Info, "Loading defaultSettings");
    return {
      unlinkedOnly: true,
      name: {
        use: true,
        number: {
          use: true,
          prefix: " (",
          suffix: ")",
          type: "ar",
        },
        remove: false,
        prefix: {
          use: true,
          position: "front",
          table: "Compendium.token-mold.adjectives.RollTable.BGNM2VPUyFfA5ZMJ", // English
        },
        replace: "",
        options: {
          default: "random",
          attributes: [
            {
              attribute: "",
              languages: {
                "": "random",
              },
            },
          ],
          min: 3,
          max: 9,
        },
        baseNameOverride: false,
      },
      hp: {
        use: true,
        toChat: true,
      },
      size: {
        use: true,
      },
      config: {
        use: false,
        // data: {
        //     vision: false,
        //     displayBars: 40,
        //     displayName: 40,
        //     disposition: 0
        // },
        vision: {
          use: false,
          value: true,
        },
        displayBars: {
          use: false,
          value: 40,
        },
        bar1: {
          use: false,
          attribute: "",
        },
        bar2: {
          use: false,
          attribute: "",
        },
        displayName: {
          use: false,
          value: 40,
        },
        disposition: {
          use: false,
          value: 0,
        },
        rotation: {
          use: false,
          min: 0,
          max: 360,
        },
        scale: {
          use: false,
          min: 0.8,
          max: 1.2,
        },
      },
      overlay: {
        use: true,
        attrs: TokenMoldForm.defaultAttrs,
      },
    };
  }

  /**
   *
   * @return {void}
   */
  loadSettings() {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "loadSettings");
    this.data = game.settings.get("Token-Mold", "everyone");
    // Check for old data
    if (!this.data) {
      this.data = this.defaultSettings();
    }
    if (this.settings.config.data !== undefined) {
      for (let [key, value] of Object.entries(this.settings.config.data)) {
        this.settings.config[key] = {
          use: true,
          value: value,
        };
      }
      delete this.settings.config.data;
    }
    if (foundry.utils.getProperty(this.data, "overlay.attrs") && this.settings.overlay.attrs.length === 0) {
      delete this.settings.overlay.attrs;
    }
    if (foundry.utils.getProperty(this.data, "name.options.attributes") && this.settings.name.options.attributes.length === 0) {
      delete this.settings.name.options.attributes;
    }
    this.data = foundry.utils.mergeObject(this.defaultSettings(), this.data);

    if (TokenMold.SUPPORTED_5ESKILLS.includes(game.system.id)) {
      if (this.settings.name.options === undefined) {
        const dndOptions = this.dndDefaultNameOptions;
        this.settings.name.options.default = dndOptions.default;
        this.settings.name.options.attributes = dndOptions.attributes;
      }
    }
    this._loadDicts();
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "Loading Settings", this.data, );
  }

  /**
   *
   * @return {object}
   */
  get dndDefaultNameOptions() {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "dndDefaultNameOptions");
    return {
      default: "random",
      attributes: [
        // Various named monsters
        {
          attribute: "name",
          languages: {
            orc: "turkish",
            goblin: "indonesian",
            kobold: "norwegian",
          },
        },
        // Uncomment this section if races get implemented in FVTT
        // {
        //     attribute: "system.details.race",
        //     languages: {
        //         "dragonborn": "norwegian",
        //         "dwarf": "welsh",
        //         "elf": "irish",
        //         "halfling": "english",
        //         "half-elf": "finnish",
        //         "half-orc": "turkish",
        //         "human": "english",
        //         "gnome": "dutch",
        //         "tiefling": "spanish",
        //     }
        // },
        // NPC Types
        {
          attribute: "system.details.type",
          languages: {
            humanoid: "irish",
            aberration: "icelandic",
            beast: "danish",
            celestial: "albanian",
            construct: "azeri",
            dragon: "latvian",
            elemental: "swedish",
            fey: "romanian",
            fiend: "sicilian",
            giant: "german",
            monstrosity: "slovenian",
            ooze: "welsh",
            plant: "zulu",
            undead: "french",
          },
        },
      ],
    };
  }

  /**
   *
   * @return {Promise<>}
   */
  async saveSettings() {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "saveSettings");
    if (this.adjectives || this.adjectives.uuid !== this.settings.name.prefix.table) {
      this._loadTable();
    }

    if (this.settings.name.replace === "remove" && !this.settings.name.number.use && !this.settings.name.prefix.use) {
      this.settings.name.replace = "nothing";
      TokenMold.log(TokenMold.LOG_LEVEL.Warn, game.i18n.localize("tmold.warn.removeName"), );
      ui.notifications.warn(game.i18n.localize("tmold.warn.removeName"));
    }

    await game.settings.set("Token-Mold", "everyone", this.data);
    this._loadDicts();
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "Saving Settings", this.data, );
  }

  /**
   *
   * @return {Promise<object>}
   */
  async _getBarAttributes() {
    TokenMold.log(TokenMold.LOG_LEVEL.Debug, "_getBarAttributes");
    const types = CONFIG.Actor.documentClass.TYPES.filter(x => x !== 'base');
    let barData = { bar: {}, value: {} };
    let addElement = (obj, key, val) => {
      if (obj[key]) obj[key] += ", " + val;
      else obj[key] = val;
    };
    for (const type of types) {
      try {
        const docClass = new CONFIG.Actor.documentClass({
          type: type,
          name: "tmp",
        }).system;
        const { bar, value } =
          CONFIG.Token.documentClass.getTrackedAttributes(docClass);
        for (const val of bar) {
          addElement(barData.bar, val.join("."), type);
        }
        for (const val of value) {
          addElement(barData.value, val.join("."), type);
        }
      } catch (e) {
        TokenMold.log(TokenMold.LOG_LEVEL.Debug, "Error navigating document class type!", type, e, );
      }
    }
    return barData;
  }
}
