// Copyright 2012 Google Inc.  All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License.  You may obtain a copy
// of the License at: http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software distrib-
// uted under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES
// OR CONDITIONS OF ANY KIND, either express or implied.  See the License for
// specific language governing permissions and limitations under the License.

/**
 * @fileoverview [MODULE: edit] Presenter for editing functionality.
 *     Non-editing behaviours are implemented in Presenter.
 * @author kpy@google.com (Ka-Ping Yee)
 */
goog.provide('cm.EditPresenter');

goog.require('cm.ArrangeCommand');
goog.require('cm.ArrangeView');
goog.require('cm.CheckboxEditor');
goog.require('cm.ChoiceEditor');
goog.require('cm.Command');
goog.require('cm.CreateLayersCommand');
goog.require('cm.CreateTopicsCommand');
goog.require('cm.DeleteLayerCommand');
goog.require('cm.DeleteTopicCommand');
goog.require('cm.EditCommand');
goog.require('cm.HtmlEditor');
goog.require('cm.ImporterView');
goog.require('cm.InspectorPopup');
goog.require('cm.LatLonBoxEditor');
goog.require('cm.LayerMenuEditor');
goog.require('cm.LayerModel');
goog.require('cm.LegendEditor');
goog.require('cm.MapModel');
goog.require('cm.MenuEditor');
goog.require('cm.NumberEditor');
goog.require('cm.QuestionEditor');
goog.require('cm.QuestionListEditor');
goog.require('cm.RadioEditor');
goog.require('cm.SetDefaultViewCommand');
goog.require('cm.ShareEmailView');
goog.require('cm.TextEditor');
goog.require('cm.TextListEditor');
goog.require('cm.TopicSelectorView');
goog.require('cm.UrlEditor');
goog.require('cm.WmsMenuEditor');
goog.require('cm.css');
goog.require('cm.editors');
goog.require('cm.events');
goog.require('cm.xhr');

/**
 * The map of editors, by type, available to the EditPresenter.
 * Editors are registered in the constructor.
 * @type {Object}
 */
var EDITORS = goog.object.create(
    cm.editors.Type.CHECKBOX, cm.CheckboxEditor,
    cm.editors.Type.CHOICE, cm.ChoiceEditor,
    cm.editors.Type.HTML, cm.HtmlEditor,
    cm.editors.Type.LAT_LON_BOX, cm.LatLonBoxEditor,
    cm.editors.Type.LAYER_MENU, cm.LayerMenuEditor,
    cm.editors.Type.LEGEND, cm.LegendEditor,
    cm.editors.Type.MENU, cm.MenuEditor,
    cm.editors.Type.NUMBER, cm.NumberEditor,
    cm.editors.Type.QUESTION, cm.QuestionEditor,
    cm.editors.Type.QUESTION_LIST, cm.QuestionListEditor,
    cm.editors.Type.RADIO, cm.RadioEditor,
    cm.editors.Type.TEXT, cm.TextEditor,
    cm.editors.Type.TEXT_LIST, cm.TextListEditor,
    cm.editors.Type.URL, cm.UrlEditor,
    cm.editors.Type.WMS_MENU, cm.WmsMenuEditor);

/**
 * Presenter for editing functionality.
 * @param {cm.AppState} appState The application state.
 * @param {cm.MapModel} mapModel The map model.
 * @param {cm.ArrangeView} arranger The nested folder arranger view.
 * @param {Object=} opt_config Configuration settings.  These fields are used:
 *     api_maps_url: The URL from which to GET maps with layers to import.
 *     legend_url: The URL of the legend item extractor service.
 *     share_url: The URL to which to POST to share the map.
 *     save_url: The URL to which to POST to save the edited map data.
 *     enable_osm_map_type_editing: Allow OSM as a base map option?
 * @constructor
 */
cm.EditPresenter = function(appState, mapModel, arranger, opt_config) {
  var config = opt_config || {};
  var importer = new cm.ImporterView(config['api_maps_url']);
  var topicSelector = new cm.TopicSelectorView(mapModel);
  var inspector = new cm.InspectorPopup();
  var sharer = new cm.ShareEmailView();

  /**
   * @type Array.<cm.Command>
   * @private
   */
  this.commands_ = [];

  /**
   * @type number
   * @private
   */
  this.nextRedoIndex_ = 0;

  /**
   * @type string
   * @private
   */
  this.saveUrl_ = config['save_url'];

  goog.object.forEach(EDITORS, function(editor, type) {
    cm.editors.register(type, editor);
  });

  function isTrue(value) {
    return !!value;
  }

  function usesUrlField(type) {
    return type === cm.LayerModel.Type.KML ||
        type === cm.LayerModel.Type.GEOJSON ||
        type === cm.LayerModel.Type.GEORSS ||
        type === cm.LayerModel.Type.TILE ||
        type === cm.LayerModel.Type.WMS ||
        type === cm.LayerModel.Type.CSV ||
        type === cm.LayerModel.Type.GOOGLE_SPREADSHEET;
  }

  function hasDownloadOrViewLink(type) {
    return type === cm.LayerModel.Type.KML ||
        type === cm.LayerModel.Type.GEOJSON ||
        type === cm.LayerModel.Type.GEORSS ||
        type === cm.LayerModel.Type.CSV ||
        type === cm.LayerModel.Type.GOOGLE_SPREADSHEET ||
        type === cm.LayerModel.Type.GOOGLE_MAPS_ENGINE_LITE_OR_PRO;
  }

  function usesKmlifyFields(type) {
    return type === cm.LayerModel.Type.GEOJSON ||
        type === cm.LayerModel.Type.CSV ||
        type === cm.LayerModel.Type.GOOGLE_SPREADSHEET;
  }

  function usesKmlifyLatLonFields(type) {
    return type === cm.LayerModel.Type.CSV ||
        type === cm.LayerModel.Type.GOOGLE_SPREADSHEET;
  }

  function usesKmlifyStyleFields(type) {
    return type === cm.LayerModel.Type.CSV ||
        type === cm.LayerModel.Type.GOOGLE_SPREADSHEET;
  }

  function isType(type) {
    return function(t) { return t === type; };
  }

  function isPlainLayer(type) {
    return type !== cm.LayerModel.Type.FOLDER;
  }

  var layerTypeChoices = [
    {value: cm.LayerModel.Type.KML, label: 'KML'},
    {value: cm.LayerModel.Type.GEOJSON, label: 'GeoJSON'},
    {value: cm.LayerModel.Type.GEORSS, label: 'GeoRSS'},
    {value: cm.LayerModel.Type.TILE,
     label: cm.MSG_LAYER_TYPE_TILE_SERVICE},
    {value: cm.LayerModel.Type.WMS, label: 'WMS'},
    {value: cm.LayerModel.Type.CSV, label: 'CSV'},
    {value: cm.LayerModel.Type.GOOGLE_SPREADSHEET,
     label: cm.MSG_LAYER_TYPE_GOOGLE_SPREADSHEET},
    {value: cm.LayerModel.Type.FUSION, label: cm.MSG_LAYER_TYPE_FUSION_TABLES},
    {value: cm.LayerModel.Type.GOOGLE_MAPS_ENGINE_LITE_OR_PRO,
     label: cm.MSG_LAYER_TYPE_MAPS_ENGINE_LITE_OR_PRO},
    {value: cm.LayerModel.Type.MAPS_ENGINE,
     label: cm.MSG_LAYER_TYPE_MAPS_ENGINE},
    {value: cm.LayerModel.Type.TRAFFIC, label: cm.MSG_LAYER_TYPE_TRAFFIC},
    {value: cm.LayerModel.Type.TRANSIT, label: cm.MSG_LAYER_TYPE_TRANSIT},
    {value: cm.LayerModel.Type.WEATHER, label: cm.MSG_LAYER_TYPE_WEATHER},
    {value: cm.LayerModel.Type.CLOUD, label: cm.MSG_LAYER_TYPE_CLOUDS},
    {value: cm.LayerModel.Type.PLACES, label: cm.MSG_LAYER_TYPE_PLACES}
  ];


  var mapTypeChoices = [
    {value: cm.MapModel.Type.ROADMAP, label: cm.MSG_BASE_MAP_TYPE_ROADMAP},
    {value: cm.MapModel.Type.SATELLITE, label: cm.MSG_BASE_MAP_TYPE_SATELLITE},
    {value: cm.MapModel.Type.HYBRID, label: cm.MSG_BASE_MAP_TYPE_HYBRID},
    {value: cm.MapModel.Type.TERRAIN, label: cm.MSG_BASE_MAP_TYPE_TERRAIN},
    {value: cm.MapModel.Type.CUSTOM, label: cm.MSG_BASE_MAP_TYPE_CUSTOM}
  ];

  var hotspotChoices = [
    {value: '', label: cm.MSG_HOTSPOT_CENTER},
    {value: 'b', label: cm.MSG_HOTSPOT_BOTTOM_CENTER},
    {value: 't', label: cm.MSG_HOTSPOT_TOP_CENTER},
    {value: 'l', label: cm.MSG_HOTSPOT_LEFT_CENTER},
    {value: 'r', label: cm.MSG_HOTSPOT_RIGHT_CENTER},
    {value: 'tl', label: cm.MSG_HOTSPOT_TOP_LEFT},
    {value: 'tr', label: cm.MSG_HOTSPOT_TOP_RIGHT},
    {value: 'bl', label: cm.MSG_HOTSPOT_BOTTOM_LEFT},
    {value: 'br', label: cm.MSG_HOTSPOT_BOTTOM_RIGHT}
  ];

  if (config['enable_osm_map_type_editing']) {
    mapTypeChoices.push({value: cm.MapModel.Type.OSM, label: 'OpenStreetMap'});
  }

  // Fields that are editable in the map inspector.  Items in this array
  // must have distinct 'key' strings.
  var mapFields = [
    {key: 'title', label: cm.MSG_TITLE, type: cm.editors.Type.TEXT},
    {key: 'description', label: cm.MSG_DESCRIPTION, type: cm.editors.Type.HTML,
     preview_class: cm.css.MAP_DESCRIPTION},
    {key: 'footer', label: cm.MSG_FOOTER, type: cm.editors.Type.HTML,
     preview_class: cm.css.FOOTER},
    {key: 'viewport', label: cm.MSG_DEFAULT_VIEWPORT,
     type: cm.editors.Type.LAT_LON_BOX, app_state: appState},
    {key: 'map_type', label: cm.MSG_DEFAULT_BASE_MAP,
     type: cm.editors.Type.MENU, choices: mapTypeChoices},
    {key: 'base_map_style', label: cm.MSG_CUSTOM_BASE_MAP_STYLE,
     type: cm.editors.Type.TEXT,
     conditions: {'map_type': isType(cm.MapModel.Type.CUSTOM)}},
    {key: 'base_map_style_name', label: cm.MSG_CUSTOM_STYLE_NAME,
     type: cm.editors.Type.TEXT,
     conditions: {'map_type': isType(cm.MapModel.Type.CUSTOM)}}
 ];

  // TODO(kpy): Fix up InspectorView so that it's okay for multiple editors to
  // use the same .key as long as they're not simultaneously active.  This
  // would let us show different tooltips for the 'url' field depending on
  // the layer type, for example.

  // Fields that are editable in the layer inspector.  Items in this array
  // must have distinct 'key' strings.
  var layerFields = [
    // Settings that don't depend on the layer type
    {key: 'title', label: cm.MSG_TITLE, type: cm.editors.Type.TEXT,
     tooltip: cm.MSG_LAYER_TITLE_TOOLTIP},
    {key: 'description', label: cm.MSG_DESCRIPTION, type: cm.editors.Type.HTML,
     preview_class: cm.css.LAYER_DESCRIPTION,
     tooltip: cm.MSG_LAYER_DESCRIPTION_TOOLTIP},
    {key: 'legend', label: cm.MSG_LEGEND, type: cm.editors.Type.LEGEND,
     preview_class: cm.css.LAYER_LEGEND, legend_url: config['legend_url'],
     tooltip: cm.MSG_LEGEND_TOOLTIP},
    {key: 'viewport', label: cm.MSG_LAYER_VIEWPORT,
     type: cm.editors.Type.LAT_LON_BOX, app_state: appState,
     tooltip: cm.MSG_LAYER_VIEWPORT_TOOLTIP},
    {key: 'min_zoom', label: cm.MSG_MINIMUM_ZOOM,
     type: cm.editors.Type.NUMBER, minimum: 0, maximum: 20,
     require_integer: true, tooltip: cm.MSG_MINIMUM_ZOOM_TOOLTIP},
    {key: 'max_zoom', label: cm.MSG_MAXIMUM_ZOOM,
     type: cm.editors.Type.NUMBER, minimum: 0, maximum: 20,
     require_integer: true, tooltip: cm.MSG_MAXIMUM_ZOOM_TOOLTIP},
    // Settings that depend on the layer type
    {key: 'type', label: cm.MSG_LAYER_TYPE,
     type: cm.editors.Type.MENU, choices: layerTypeChoices,
     conditions: {'type': isPlainLayer},
     tooltip: cm.MSG_LAYER_TYPE_TOOLTIP},
    {key: 'url', label: cm.MSG_SOURCE_URL, type: cm.editors.Type.URL,
     conditions: {'type': usesUrlField},
     tooltip: cm.MSG_SOURCE_URL_TOOLTIP},
    {key: 'maps_engine_url', label: cm.MSG_SOURCE_URL,
     type: cm.editors.Type.URL,
     conditions: {'type':
                  isType(cm.LayerModel.Type.GOOGLE_MAPS_ENGINE_LITE_OR_PRO)},
     tooltip: cm.MSG_MAPS_ENGINE_LITE_OR_PRO_URL_TOOLTIP},
    {key: 'suppress_download_link', label: cm.MSG_SHOW_DOWNLOAD_LINK,
     type: cm.editors.Type.CHECKBOX, checked_value: null,
      unchecked_value: true, conditions: {'type': hasDownloadOrViewLink},
     tooltip: cm.MSG_SHOW_DOWNLOAD_LINK_TOOLTIP},
    // TODO(romano): protect this field with a config variable
    {key: 'url_is_tile_index', label: cm.MSG_TILE_INDEX,
     type: cm.editors.Type.CHECKBOX, checked_value: true,
     unchecked_value: false,
     conditions: {'type': isType(cm.LayerModel.Type.TILE)},
     tooltip: cm.MSG_TILE_INDEX_TOOLTIP},
    {key: 'title_template', label: cm.MSG_PLACEMARK_TITLE,
     type: cm.editors.Type.TEXT,
     conditions: {'type': usesKmlifyFields},
     tooltip: cm.MSG_PLACEMARK_TITLE_TOOLTIP},
    {key: 'description_template', label: cm.MSG_PLACEMARK_DESCRIPTION,
     type: cm.editors.Type.HTML,
     conditions: {'type': usesKmlifyFields},
     tooltip: cm.MSG_PLACEMARK_DESCRIPTION_TOOLTIP},
    {key: 'latitude_field', label: cm.MSG_LATITUDE_FIELD,
     type: cm.editors.Type.TEXT,
     conditions: {'type': usesKmlifyLatLonFields},
     tooltip: cm.MSG_LATITUDE_FIELD_TOOLTIP},
    {key: 'longitude_field', label: cm.MSG_LONGITUDE_FIELD,
     type: cm.editors.Type.TEXT,
     conditions: {'type': usesKmlifyLatLonFields},
     tooltip: cm.MSG_LONGITUDE_FIELD_TOOLTIP},
    {key: 'icon_url_template', label: cm.MSG_ICON_URL,
     type: cm.editors.Type.TEXT,
     conditions: {'type': usesKmlifyStyleFields},
     tooltip: cm.MSG_ICON_URL_TOOLTIP},
    {key: 'color_template', label: cm.MSG_ICON_COLOR_TINT,
     type: cm.editors.Type.TEXT,
     conditions: {'type': usesKmlifyStyleFields},
     tooltip: cm.MSG_ICON_COLOR_TINT_TOOLTIP},
    {key: 'hotspot_template', label: cm.MSG_ICON_HOTSPOT,
     type: cm.editors.Type.MENU, choices: hotspotChoices,
     conditions: {'type': usesKmlifyStyleFields},
     tooltip: cm.MSG_ICON_HOTSPOT_TOOLTIP},
    {key: 'condition0', label: cm.MSG_FILTER_CONDITION,
     type: cm.editors.Type.TEXT,
     conditions: {'type': usesKmlifyFields},
     tooltip: cm.MSG_FILTER_CONDITION_TOOLTIP},
    {key: 'condition1', label: cm.MSG_FILTER_CONDITION,
     type: cm.editors.Type.TEXT,
     conditions: {'type': usesKmlifyFields},
     tooltip: cm.MSG_FILTER_CONDITION_TOOLTIP},
    {key: 'condition2', label: cm.MSG_FILTER_CONDITION,
     type: cm.editors.Type.TEXT,
     conditions: {'type': usesKmlifyFields},
     tooltip: cm.MSG_FILTER_CONDITION_TOOLTIP},
    {key: 'ft_from', label: cm.MSG_GFT_TABLE_ID,
     type: cm.editors.Type.TEXT,
     conditions: {'type': isType(cm.LayerModel.Type.FUSION)},
     tooltip: cm.MSG_GFT_TABLE_ID_TOOLTIP},
    {key: 'ft_select', label: cm.MSG_GFT_LOCATION_COLUMN,
     type: cm.editors.Type.TEXT,
     conditions: {'type': isType(cm.LayerModel.Type.FUSION)},
     tooltip: cm.MSG_GFT_LOCATION_COLUMN_TOOLTIP},
    {key: 'ft_where', label: cm.MSG_GFT_FILTER_CONDITION,
     type: cm.editors.Type.TEXT,
     conditions: {'type': isType(cm.LayerModel.Type.FUSION)},
     tooltip: cm.MSG_GFT_FILTER_CONDITION_TOOLTIP},
    {key: 'ft_heatmap', label: cm.MSG_GFT_HEATMAP,
     type: cm.editors.Type.CHECKBOX,
     conditions: {'type': isType(cm.LayerModel.Type.FUSION)},
     tooltip: cm.MSG_GFT_HEATMAP_TOOLTIP},
    {key: 'label_color', label: cm.MSG_WEATHER_LABEL_COLOR,
     type: cm.editors.Type.MENU,
     conditions: {'type': isType(cm.LayerModel.Type.WEATHER)},
     choices: [
       {value: cm.LayerModel.LabelColor.BLACK, label: cm.MSG_BLACK},
       {value: cm.LayerModel.LabelColor.WHITE, label: cm.MSG_WHITE}
     ],
     tooltip: cm.MSG_WEATHER_LABEL_COLOR_TOOLTIP},
    {key: 'temperature_unit', label: cm.MSG_WEATHER_TEMPERATURE_UNIT,
     type: cm.editors.Type.MENU,
     conditions: {'type': isType(cm.LayerModel.Type.WEATHER)},
     choices: [
       {value: cm.LayerModel.TemperatureUnit.CELSIUS, label: cm.MSG_CELSIUS},
       {value: cm.LayerModel.TemperatureUnit.FAHRENHEIT,
        label: cm.MSG_FAHRENHEIT}
     ],
     tooltip: cm.MSG_WEATHER_TEMPERATURE_UNIT_TOOLTIP},
    {key: 'wind_speed_unit', label: cm.MSG_WEATHER_WIND_SPEED_UNIT,
     type: cm.editors.Type.MENU,
     conditions: {'type': isType(cm.LayerModel.Type.WEATHER)},
     choices: [
       {value: cm.LayerModel.WindSpeedUnit.KILOMETERS_PER_HOUR, label: 'km/h'},
       {value: cm.LayerModel.WindSpeedUnit.METERS_PER_SECOND, label: 'm/s'},
       {value: cm.LayerModel.WindSpeedUnit.MILES_PER_HOUR, label: 'mph'}
     ],
     tooltip: cm.MSG_WEATHER_WIND_SPEED_UNIT_TOOLTIP},
    {key: 'maps_engine_map_id', label: cm.MSG_GME_MAP_ID,
     type: cm.editors.Type.TEXT,
     conditions: {'type': isType(cm.LayerModel.Type.MAPS_ENGINE)},
     tooltip: cm.MSG_GME_MAP_ID_TOOLTIP},
    {key: 'maps_engine_layer_key', label: cm.MSG_GME_LAYER_KEY,
     type: cm.editors.Type.TEXT,
     conditions: {'type': isType(cm.LayerModel.Type.MAPS_ENGINE)},
     tooltip: cm.MSG_GME_LAYER_KEY_TOOLTIP},
    {key: 'wms_layers', label: cm.MSG_WMS_LAYERS,
     type: cm.editors.Type.WMS_MENU,
     conditions: {'type': isType(cm.LayerModel.Type.WMS)},
     multiple: true, menu_class: cm.css.WMS_MENU_EDITOR,
     wms_query_url: config['wms_query_url'],
     tooltip: cm.MSG_WMS_LAYERS_TOOLTIP},
    {key: 'tile_coordinate_type',
     label: cm.MSG_TILE_COORDINATE_TYPE,
     type: cm.editors.Type.MENU,
     conditions: {'type': isType(cm.LayerModel.Type.TILE)},
     choices: [
       {value: cm.LayerModel.TileCoordinateType.GOOGLE,
        label: cm.MSG_GOOGLE_MAPS_COORDINATES},
       {value: cm.LayerModel.TileCoordinateType.BING,
        label: cm.MSG_BING_MAPS_QUADKEYS},
       {value: cm.LayerModel.TileCoordinateType.TMS,
        label: cm.MSG_TMS_COORDINATES}],
     tooltip: cm.MSG_TILE_COORDINATE_TYPE_TOOLTIP},
    {key: 'folder_type', label: cm.MSG_FOLDER_TYPE,
      type: cm.editors.Type.MENU,
      choices: [
        {value: cm.LayerModel.FolderType.UNLOCKED,
         label: cm.MSG_FOLDER_TYPE_UNLOCKED},
        {value: cm.LayerModel.FolderType.LOCKED,
         label: cm.MSG_FOLDER_TYPE_LOCKED},
        {value: cm.LayerModel.FolderType.SINGLE_SELECT,
         label: cm.MSG_FOLDER_TYPE_SINGLE_SELECT}
      ],
     conditions: {'type': isType(cm.LayerModel.Type.FOLDER)},
     tooltip: cm.MSG_FOLDER_TYPE_TOOLTIP},
   {key: 'places_icon_url', label: cm.MSG_PLACES_ICON_URL,
     type: cm.editors.Type.TEXT,
     conditions: {'type': isType(cm.LayerModel.Type.PLACES)},
     tooltip: cm.MSG_PLACES_ICON_URL_TOOLTIP},
   {key: 'places_keyword', label: cm.MSG_PLACES_KEYWORD,
     type: cm.editors.Type.TEXT,
     conditions: {'type': isType(cm.LayerModel.Type.PLACES)},
     tooltip: cm.MSG_PLACES_KEYWORD_TOOLTIP},
   {key: 'places_name', label: cm.MSG_PLACES_NAME,
     type: cm.editors.Type.TEXT,
     conditions: {'type': isType(cm.LayerModel.Type.PLACES)},
     tooltip: cm.MSG_PLACES_NAME_TOOLTIP},
   {key: 'places_types', label: cm.MSG_PLACES_TYPES,
     type: cm.editors.Type.TEXT, // TODO(user): dropdown or autocomplete
     conditions: {'type': isType(cm.LayerModel.Type.PLACES)},
     tooltip: cm.MSG_PLACES_TYPES_TOOLTIP}
    // TODO(user): as a follow-up CL, maybe add a a language param
    // to specify what language to show places results in

  ];

  var topicFields = [
   {key: 'title', label: cm.MSG_TITLE, type: cm.editors.Type.TEXT,
    tooltip: cm.MSG_TOPIC_TITLE_TOOLTIP},
   {key: 'tags', label: cm.MSG_TAGS, type: cm.editors.Type.TEXT_LIST,
    tooltip: cm.MSG_TOPIC_TAGS_TOOLTIP},
   {key: 'layer_ids', label: cm.MSG_LAYERS_FOR_THIS_TOPIC,
    type: cm.editors.Type.LAYER_MENU, multiple: true, choices: [],
    menu_class: cm.css.WMS_MENU_EDITOR, map_model: mapModel,
    tooltip: cm.MSG_LAYER_MENU_TOOLTIP},
   {key: 'viewport', label: cm.MSG_DEFAULT_VIEWPORT,
    type: cm.editors.Type.LAT_LON_BOX, app_state: appState,
    hide_tile_layer_warning: true, tooltip: cm.MSG_TOPIC_VIEWPORT_TOOLTIP},
   {key: 'crowd_enabled', label: cm.MSG_ENABLE_CROWD_REPORTS,
    type: cm.editors.Type.CHECKBOX, checked_value: true, unchecked_value: null,
    tooltip: cm.MSG_CROWD_ENABLED_TOOLTIP},
   {key: 'cluster_radius', label: cm.MSG_CLUSTER_RADIUS,
    type: cm.editors.Type.NUMBER, conditions: {'crowd_enabled': isTrue},
    default_value: 50, minimum: 1, tooltip: cm.MSG_CLUSTER_RADIUS_TOOLTIP},
   {key: 'questions', label: cm.MSG_SURVEY_QUESTIONS,
    type: cm.editors.Type.QUESTION_LIST,
    conditions: {'crowd_enabled': isTrue},
    tooltip: cm.MSG_QUESTION_LIST_TOOLTIP}
 ];

  // The user has asked us to bring up an inspector.
  // The INSPECT event contains an object for editing existing objects, or
  // no object for a new layer or topic.
  // TODO(joeysilva): Use a type field to specify new layers or new folders.
  cm.events.listen(cm.app, cm.events.INSPECT, function(e) {
    if (e.isNewTopic) {
      // New topic
      inspector.inspect(
          cm.MSG_CREATE_NEW_TOPIC, topicFields, appState, null, false);
    } else if (!e.object) {
      // New layer
      inspector.inspect(
          cm.MSG_CREATE_NEW_LAYER, layerFields, appState, null, true);
    } else if (e.object instanceof cm.MapModel) {
      inspector.inspect(
          cm.MSG_EDIT_MAP_DETAILS, mapFields, appState, e.object, false);
    } else if (e.object instanceof cm.LayerModel) {
      inspector.inspect(
          cm.MSG_EDIT_LAYER_DETAILS, layerFields, appState, e.object, false);
    } else if (e.object instanceof cm.TopicModel) {
      inspector.inspect(
          cm.MSG_EDIT_TOPIC, topicFields, appState, e.object, false);
    }
  });

  // The user has requested to arrange the layers in the panel.
  cm.events.listen(cm.app, cm.events.ARRANGE, function(e) {
    if (!arranger.isOpen()) {
      arranger.open();
    }
  });

  // The user has requested to add layers.
  cm.events.listen(cm.app, cm.events.IMPORT, function(e) {
    importer.openImporter();
  });

  // The user has selected some layers to import and wants to import them.
  cm.events.listen(cm.app, cm.events.ADD_LAYERS, function(e) {
    this.doCommand(new cm.CreateLayersCommand(e.layers), appState, mapModel);
  }, this);

  // The user has filled in properties for a new layer and wants to create the
  // layer.
  cm.events.listen(cm.app, cm.events.NEW_LAYER, function(e) {
    var model = cm.LayerModel.newFromMapRoot({type: 'KML'});
    for (var key in e.properties) {
      if (e.properties[key] !== undefined) {
        model.set(key, e.properties[key]);
      }
    }
    this.doCommand(new cm.CreateLayersCommand([model.toMapRoot()]),
                   appState, mapModel);
  }, this);

  // The user has requested to delete a layer.
  cm.events.listen(cm.app, cm.events.DELETE_LAYER, function(e) {
    this.doCommand(new cm.DeleteLayerCommand(e.id), appState, mapModel);
  }, this);

  // The user has filled in properties for a new topic and wants to create the
  // topic.
  cm.events.listen(cm.app, cm.events.NEW_TOPIC, function(e) {
    var model = cm.TopicModel.newFromMapRoot(e.properties,
                                             mapModel.getLayerIds());
    if (e.properties['questions']) {
      // e.properties['questions'] is a javascript object with keys that may
      // have been obfuscated by the closure compiler, but newFromMapRoot
      // assumes the keys quoted and not obfuscated. Thus, we need to
      // separately set the questions javascript blob here.
      model.set('questions', e.properties['questions']);
    }
    this.doCommand(new cm.CreateTopicsCommand([model.toMapRoot()]),
                   appState, mapModel);
  }, this);

  // The user has requested to delete a topic.
  cm.events.listen(cm.app, cm.events.DELETE_TOPIC, function(e) {
    this.doCommand(new cm.DeleteTopicCommand(e.id), appState, mapModel);
  }, this);

  // The user has requested to save the current map model to the server.
  cm.events.listen(cm.app, cm.events.SAVE, this.handleSave, this);

  // The user has finished an edit and wants to commit the changes.
  cm.events.listen(cm.app, cm.events.OBJECT_EDITED, function(e) {
    this.doCommand(
        new cm.EditCommand(e.oldValues, e.newValues, e.layerId, e.topicId),
        appState, mapModel);
  }, this);

  // The user has finished arranging layers and wants to commit the changes.
  cm.events.listen(cm.app, cm.events.LAYERS_ARRANGED, function(e) {
    this.doCommand(new cm.ArrangeCommand(e.oldValue, e.newValue),
                   appState, mapModel);
    cm.events.emit(cm.app, cm.events.MODEL_CHANGED, {model: mapModel});
  }, this);

  // The user has requested undo or redo.
  cm.events.listen(cm.app, cm.events.UNDO, function() {
    this.handleUndo(appState, mapModel);
  }, this);
  cm.events.listen(cm.app, cm.events.REDO, function() {
    this.handleRedo(appState, mapModel);
  }, this);

  cm.events.listen(cm.app, cm.events.SHARE_EMAIL, function() {
    sharer.share(config['share_url']);
  }, this);

  cm.events.listen(cm.app, cm.events.SHARE_EMAIL_FAILED, function() {
    sharer.emailError();
  }, this);

  // The user has set the current view as the default view.
  cm.events.listen(cm.app, cm.events.DEFAULT_VIEW_SET, function(e) {
    this.doCommand(new cm.SetDefaultViewCommand(e.oldDefault, e.newDefault),
                   appState, mapModel);
  }, this);

  // The user has requested to edit topics for the map.
  cm.events.listen(cm.app, cm.events.EDIT_TOPICS, function(e) {
    if (!topicSelector.isOpen()) {
      topicSelector.open();
    }
  });
};

/**
 * @param {cm.Command} command An undoable command to perform.
 * @param {cm.AppState} appState The state of the application.
 * @param {cm.MapModel} mapModel The map model.
 */
cm.EditPresenter.prototype.doCommand = function(command, appState, mapModel) {
  if (command.execute(appState, mapModel)) {
    this.commands_.length = this.nextRedoIndex_;
    this.commands_.push(command);
    this.addToNextRedoIndex_(1);
  } else {
    // TODO(kpy): Handle command failure.
  }
};

/**
 * Undoes the last executed command.
 * @param {cm.AppState} appState The state of the application.
 * @param {cm.MapModel} mapModel The map model.
 */
cm.EditPresenter.prototype.handleUndo = function(appState, mapModel) {
  if (this.nextRedoIndex_ > 0) {
    if (this.commands_[this.nextRedoIndex_ - 1].undo(appState, mapModel)) {
      this.addToNextRedoIndex_(-1);
    } else {
      // TODO(kpy): Handle undo failure.
    }
  }
};

/**
 * Redoes the last undone command.
 * @param {cm.AppState} appState The state of the application.
 * @param {cm.MapModel} mapModel The map model.
 */
cm.EditPresenter.prototype.handleRedo = function(appState, mapModel) {
  if (this.nextRedoIndex_ < this.commands_.length) {
    if (this.commands_[this.nextRedoIndex_].execute(appState, mapModel)) {
      this.addToNextRedoIndex_(1);
    } else {
      // TODO(kpy): Handle redo failure.
    }
  }
};

/**
 * Saves the map model to the server.
 * @param {Object} event The SAVE event (which should have a 'model' property).
 */
cm.EditPresenter.prototype.handleSave = function(event) {
  cm.xhr.post(this.saveUrl_, {'json': event.model.toMapRoot()},
              function(ok) {
    cm.events.emit(cm.app, ok ? cm.events.SAVE_DONE : cm.events.SAVE_FAILED);
  });
};

/**
 * Adds a given value to {@code this.nextRedoIndex_}.
 * @param {number} value The value to add.
 * @private
 */
cm.EditPresenter.prototype.addToNextRedoIndex_ = function(value) {
  this.nextRedoIndex_ += value;
  cm.events.emit(cm.app, cm.events.UNDO_REDO_BUFFER_CHANGED,
      {redo_possible: this.nextRedoIndex_ !== this.commands_.length,
       undo_possible: this.nextRedoIndex_ !== 0});
};
