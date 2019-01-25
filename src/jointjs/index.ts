import injectCustomRouter from "./router";
import injectCustomShapes from "./shapes";
import {
  isFilteredEntity,
  isBaseEntity,
  isRelatedType,
  getNestedType,
  getFieldLabel
} from "../utils";
import {
  GraphQLNamedType,
  GraphQLInputObjectType,
  GraphQLEnumType,
  GraphQLScalarType,
  GraphQLUnionType,
  GraphQLObjectType
} from "graphql/type/definition";
import { TypeMap } from "graphql/type/schema";
import defaultTheme, { Theme } from "../defaultTheme";
var joint = require("jointjs");
var svgPanZoom = require("svg-pan-zoom");
var animate = require("@f/animate");
const TRANSITION_DURATION = 500;

export type FilteredGraphqlOutputType = Exclude<
  GraphQLNamedType,
  | GraphQLInputObjectType
  | GraphQLEnumType
  | GraphQLScalarType
  | GraphQLUnionType
>;

export type EventType = "loading:start" | "loading:stop";

export default class JointJS {
  joint: any;
  theme: Theme;
  graph: any;
  paper: any;
  shadowPaper: any;
  panZoom: any;
  maxZoom: number = 20;
  typeMap: TypeMap;
  activeType: string = "root";
  eventMap: { [key in EventType]?: () => any } = {};
  constructor(opts: { theme?: Theme }) {
    const { theme = defaultTheme } = opts;
    injectCustomShapes(joint, theme);
    injectCustomRouter(joint);
    this.joint = joint;
    this.theme = theme;
  }
  async init(el: any, bounds: any, typeMap: TypeMap) {
    this.typeMap = typeMap;
    this.graph = new joint.dia.Graph();
    this.paper = new joint.dia.Paper({
      el,
      model: this.graph,
      width: bounds.width,
      height: bounds.height,
      background: {
        color: this.theme.colors.background
      },
      gridSize: 1,
      defaultRouter: {
        name: "metro",
        args: {
          endDirection: ["top", "bottom"],
          paddingBox: 200,
          step: 100
        }
      },
      defaultConnector: { name: "rounded", args: { radius: 200 } },
      interactive: {
        linkMove: false
      }
    });
    this.paper.setInteractivity(false);
    // enable interactions
    await this.renderElements({ animate: false });
    // tools are visible by default
    this.paper.hideTools();
    // enable tools
    this.bindToolEvents();
    this.resizeToFit({ animate: false });
  }
  /**
   * Events
   */
  on(key: EventType, callback: () => any) {
    this.eventMap[key] = callback;
  }
  startLoading() {
    const onStart = this.eventMap["loading:start"];
    if (onStart) {
      onStart();
    }
  }
  stopLoading() {
    const onStop = this.eventMap["loading:stop"];
    if (onStop) {
      onStop();
    }
  }
  async setTypeMap(newTypeMap) {
    this.typeMap = newTypeMap;
    await this.renderElements(newTypeMap);
  }
  setActiveType(activeType: any) {
    if (this.graph.getCell(activeType).attributes.type === "devs.Model") {
      this.activeType = activeType;
      this.renderElements();
    }
  }
  private async resizeToFit(opts?: { graph?: any; animate?: boolean }) {
    const { graph = this.graph, animate = true } = opts || {};
    if (!this.panZoom) {
      this.panZoom = svgPanZoom("#v-2", {
        fit: true,
        controlIconsEnabled: true,
        maxZoom: this.maxZoom,
        panEnabled: false
      });

      this.paper.on("blank:pointerdown", () => {
        this.panZoom.enablePan();
      });
      this.paper.on("cell:pointerup blank:pointerup", () => {
        this.panZoom.disablePan();
      });
      this.paper.on("resize", () => {
        this.panZoom.reset();
      });
    }
    this.panZoom.updateBBox();
    animate && this.focusBBox(this.paper.getContentBBox());
  }
  focusBBox(bBox) {
    const bbBox = bBox;
    let currentPan = this.panZoom.getPan();
    bbBox.y = currentPan.y;
    bbBox.x = currentPan.x;
    let viewPortSizes = (<any>this.panZoom).getSizes();
    currentPan.x += viewPortSizes.width / 2 - bbBox.width / 2;
    currentPan.y += viewPortSizes.height / 2 - bbBox.height / 2;

    let zoomUpdateToFit =
      1.2 *
      Math.max(
        bbBox.height / viewPortSizes.height,
        bbBox.width / viewPortSizes.width
      );
    let newZoom = this.panZoom.getZoom() / zoomUpdateToFit;
    let recomendedZoom = this.maxZoom * 0.6;
    if (newZoom > recomendedZoom) newZoom = recomendedZoom;
    let newX = currentPan.x - bbBox.x + 0; // this.offsetLeft;
    let newY = currentPan.y - bbBox.y + 0; //this.offsetTop;
    this.animatePanAndZoom(newX, newY, newZoom);
  }

  animatePanAndZoom(x, y, zoomEnd) {
    let pan = this.panZoom.getPan();
    let panEnd = { x, y };
    animate(pan, panEnd, props => {
      this.panZoom.pan({ x: props.x, y: props.y });
      if (props === panEnd) {
        let zoom = this.panZoom.getZoom();
        animate({ zoom }, { zoom: zoomEnd }, props => {
          this.panZoom.zoom(props.zoom);
        });
      }
    });
  }

  async renderElements(opts?: {
    typeMap?: any;
    activeType?: string;
    animate?: boolean;
  }) {
    const {
      typeMap = this.typeMap,
      activeType = this.activeType,
      animate = true
    } = opts || {};
    const toRenderTypes: FilteredGraphqlOutputType[] = this.getToRenderTypes(
      typeMap,
      activeType
    );
    this.startLoading();
    await Promise.all([
      this.removeUnusedElements(toRenderTypes, animate),
      this.addNewElements(toRenderTypes, animate)
    ]);
    this.transitionLinkColor(this.graph.getLinks(), {
      targetColor: this.theme.colors.line.active
    });
    await this.layoutGraph({ animate });
    this.stopLoading();
  }
  private async layoutGraph(opts?: { animate?: boolean }) {
    const { animate = true } = opts || {};
    if (!animate) {
      joint.layout.DirectedGraph.layout(this.graph, {
        nodeSep: 200,
        rankSep: 400,
        rankDir: "LR"
      });
      await this.resizeToFit({ animate });
    } else {
      const originalPositions = this.graph
        .getCells()
        .reduce((accumulator, cell) => {
          if (cell.isElement()) {
            accumulator[cell.attributes.id] = cell.getBBox();
          }
          return accumulator;
        }, {});
      joint.layout.DirectedGraph.layout(this.graph, {
        nodeSep: 200,
        rankSep: 500,
        rankDir: "LR"
      });
      this.resizeToFit();
      await Promise.all(
        this.graph
          .getCells()
          .filter(cell => cell.isElement())
          .map(async cell => {
            const originalBBox = originalPositions[cell.attributes.id];
            const targetBBox = cell.getBBox();
            cell.position(originalBBox.x, originalBBox.y);
            const links = this.graph.getConnectedLinks(cell);
            this.graph.removeLinks(cell);
            await Promise.all([
              cell.transitionAsync("position/x", targetBBox.x, {
                delay: 0,
                duration: TRANSITION_DURATION * 2,
                timingFunction: joint.util.timing.quad,
                valueFunction: joint.util.interpolate.number
              }),
              cell.transitionAsync("position/y", targetBBox.y, {
                delay: 0,
                duration: TRANSITION_DURATION * 2,
                timingFunction: joint.util.timing.quad,
                valueFunction: joint.util.interpolate.number
              })
            ]);
            await Promise.all(
              links.map(async link => {
                link.prop("attrs/line/opacity", 0);
                link.addTo(this.graph);
                await this.transitionLinkOpacity(link, {
                  targetOpacity: 1,
                  transitionDuration: TRANSITION_DURATION
                });
              })
            );
          })
      );
    }
    this.graph.resetCells(this.graph.getCells());
  }

  private getToRenderTypes(
    typeMap: TypeMap = this.typeMap,
    activeType: string = this.activeType
  ) {
    return Object.keys(typeMap)
      .filter(key => {
        const type = typeMap[key];
        if (isFilteredEntity(type) || isBaseEntity(type)) {
          return false;
        }
        if (activeType === "root") {
          if (type.name === "Query" || type.name === "Mutation") {
            return true;
          }
          return (
            (typeMap["Query"] &&
              isRelatedType(typeMap["Query"] as GraphQLObjectType, type)) ||
            (typeMap["Mutation"] &&
              isRelatedType(typeMap["Mutation"] as GraphQLObjectType, type))
          );
        }
        if (activeType === type.name) {
          return true;
        }
        if (type.constructor.name === "GraphQLObjectType") {
          return (
            isRelatedType(type as GraphQLObjectType, typeMap[activeType]) ||
            isRelatedType(typeMap[activeType] as GraphQLObjectType, type)
          );
        }
        return false;
      })
      .map(k => typeMap[k] as FilteredGraphqlOutputType);
  }
  private async removeUnusedElements(
    toRenderTypes: FilteredGraphqlOutputType[],
    animate: boolean
  ) {
    const currentElements = this.graph.getElements();
    const toRemove = currentElements.filter(
      (elem: any) => !toRenderTypes.find(type => type.name === elem.id)
    );
    toRemove.map(async (element: any) => {
      const links = this.graph.getConnectedLinks(element);
      animate &&
        (await this.transitionLinkColor(links, {
          transitionDuration: TRANSITION_DURATION,
          targetColor: this.theme.colors.white
        }));
      animate &&
        (await element.transitionAsync("attrs/./opacity", 0, {
          delay: 0,
          duration: TRANSITION_DURATION,
          timingFunction: joint.util.timing.quad,
          valueFunction: joint.util.interpolate.number
        }));
    });
    this.graph.removeCells(...toRemove);
  }
  private async addNewElements(
    toRenderTypes: FilteredGraphqlOutputType[],
    animate: boolean
  ) {
    const currentElements = this.graph.getElements();
    const filtered = toRenderTypes.filter(type => {
      return !currentElements.find((elem: any) => elem.id === type.name);
    });
    const cells = filtered.map(type => {
      const fields = type.getFields();
      return this.addNode({
        id: type.name,
        position: (
          this.graph.getBBox() || this.paper.getContentBBox()
        ).topLeft(),
        attrs: {
          ".": {
            opacity: animate ? 0 : 1
          },
          ".label": {
            text: type.name
          }
        },
        inPorts: Object.keys(fields),
        outPorts: Object.keys(fields).map(k => {
          const field = fields[k];
          const connectedType = getNestedType(field.type);
          const id = this.getPortId(type, field, connectedType);
          const label = getFieldLabel(field.type);
          return {
            id,
            label
          };
        })
      });
    });
    await Promise.all(
      toRenderTypes.map(async type => {
        const fields = type.getFields();
        await Promise.all(
          Object.keys(fields).map(async k => {
            const field = fields[k];
            const connectedType = getNestedType(field.type);
            const id = this.getPortId(type, field, connectedType);
            if (
              toRenderTypes.findIndex(
                type => type.name === connectedType.name
              ) > -1
            ) {
              const sourceCell = this.graph.getCell(type.name);
              const existingLinks = this.graph.getConnectedLinks(sourceCell);
              if (
                existingLinks.find(
                  (link: any) => link.attributes.source.port === id
                )
              ) {
                return;
              }
              const sourcePortPosition = sourceCell.getPortsPositions("out")[
                id
              ];
              const targetCenterPosition = this.graph
                .getCell(connectedType.name)
                .getBBox()
                .center();
              const dx = targetCenterPosition.x - sourcePortPosition.x;
              var link = new joint.shapes.devs.Link();
              link.source({
                id: type.name,
                port: id,
                anchor: {
                  name: `${dx > 0 ? "right" : "left"}`
                }
              });
              link.target({
                id: connectedType.name,
                anchor: {
                  name: `top`, // `${dy > 0 ? "top" : "bottom"}`,
                  args: {
                    dy: this.theme.row.height / 2 // dy > 0 ? ROW_HEIGHT / 2 : 0
                  }
                }
              });
              animate && link.prop("attrs/line/opacity", 0);
              link.addTo(this.graph);
            }
          })
        );
      })
    );
    animate &&
      (await Promise.all(
        cells.map((cell: any) =>
          cell.transitionAsync("attrs/./opacity", 1, {
            delay: 0,
            duration: TRANSITION_DURATION,
            timingFunction: joint.util.timing.quad,
            valueFunction: joint.util.interpolate.number
          })
        )
      ));
    this.graph.getLinks().map(async link => {
      animate &&
        this.transitionLinkOpacity(link, {
          targetOpacity: 1,
          transitionDuration: TRANSITION_DURATION
        });
      this.addTools(link);
    });
  }
  private getPortId(type, field, connectedType) {
    return `${type.name}_${field.name}_${connectedType.name}`;
  }

  private async transitionLinkOpacity(
    link: any,
    opts: { targetOpacity: number; transitionDuration: number }
  ) {
    const {
      targetOpacity = 1,
      transitionDuration = TRANSITION_DURATION
    } = opts;
    await link.transitionAsync("attrs/line/opacity", targetOpacity, {
      delay: 0,
      duration: transitionDuration,
      timingFunction: joint.util.timing.quad,
      valueFunction: joint.util.interpolate.number
    });
  }

  private addNode(node: any) {
    var a1 = new joint.shapes.devs.Model(node);
    this.graph.addCells([a1]);
    return a1;
  }
  private addTools(link: any) {
    var toolsView = new joint.dia.ToolsView({
      tools: [new joint.linkTools.TargetArrowhead()]
    });
    link.findView(this.paper).addTools(toolsView);
  }
  private bindToolEvents() {
    // show link tools
    this.paper.on("link:mouseover", (linkView: any) => {
      const links = this.graph.getLinks();
      this.transitionLinkColor(links, {
        targetColor: this.theme.colors.line.inactive
      });
      this.transitionLinkColor([linkView.model], {
        targetColor: this.theme.colors.line.active
      });
      linkView.model.toFront();
      linkView.showTools();
    });

    this.paper.on("cell:mouseover", (cell: any, evt: any) => {
      if (!cell.model.isElement()) {
        return null;
      }
      cell.model.toFront();
      let activePort = this.getHoveredPort(cell, evt);
      cell.model.getPorts().map(port => {
        cell.model.portProp(
          port.id,
          "attrs/.port-body-highlighter/fill",
          "transparent"
        );
      });
      if (!activePort) {
        return this.highlightLinks({ cell: cell.model });
      }
      if (activePort) {
        cell.model.portProp(
          activePort.id,
          "attrs/.port-body-highlighter/fill",
          this.theme.colors.background
        );
      }

      const activeLink = activePort && activePort.link;
      if (!activeLink) {
        return this.highlightLinks({ cell: cell.model });
      }
      return this.highlightLinks({
        links: [activeLink]
      });
    });
    this.paper.on("blank:mouseover cell:mouseover", () => {
      this.paper.hideTools();
    });
    this.paper.on("link:pointerclick", (linkView: any) => {
      const activeType = linkView.model.attributes.target.id;
      this.setActiveType(activeType);
    });
    this.paper.on("cell:pointerclick", (linkView: any) => {
      const activeType = linkView.model.id;
      this.setActiveType(activeType);
    });
  }
  private getHoveredPort(cell: any, evt: any) {
    if (!cell.model.isElement()) {
      return null;
    }
    const relBBox = this.joint.util.getElementBBox(cell.$el);
    const cellBBox = cell.model.getBBox();
    const getRelHeight = height => (height * relBBox.height) / cellBBox.height;
    const headerOffset = getRelHeight(
      this.theme.header.height + this.theme.gap - this.theme.row.height / 2
    );
    const relRowHeight = getRelHeight(this.theme.row.height);
    const relCursorPosition = {
      x: evt.clientX - relBBox.x,
      y: evt.clientY - (relBBox.y + headerOffset)
    };
    if (relCursorPosition.y < 0) {
      return null;
    }
    const port = cell.model.get("outPorts").find((p, index) => {
      const yMin = relRowHeight * index;
      const yMax = relRowHeight * (index + 1) - 1;
      if (relCursorPosition.y >= yMin && relCursorPosition.y <= yMax) {
        return true;
      }
      return false;
    });
    return port
      ? {
          ...port,
          link: this.graph
            .getCells()
            .find(
              cell => cell.isLink() && cell.attributes.source.port === port.id
            )
        }
      : null;
  }

  private highlightLinks(args: { cell?: any; links?: any }) {
    const { cell, links: lks } = args;
    let links = lks;
    if (cell) {
      links = this.graph.getConnectedLinks(cell);
    }
    this.transitionLinkColor(this.graph.getLinks(), {
      targetColor: this.theme.colors.line.inactive
    });
    this.transitionLinkColor(links, {
      targetColor: this.theme.colors.line.active
    });
    links.map(link => link.toFront());
  }
  private async transitionLinkColor(
    links: any,
    opts?: { transitionDuration?: number; targetColor?: string }
  ) {
    const {
      transitionDuration = 100,
      targetColor: color = this.theme.colors.primary
    } = opts || {};
    await Promise.all(
      links.map((link: any) =>
        link.transitionAsync("attrs/line/stroke", color, {
          delay: 0,
          duration: transitionDuration,
          timingFunction: joint.util.timing.quad,
          valueFunction: joint.util.interpolate.hexColor
        })
      )
    );
  }
}
