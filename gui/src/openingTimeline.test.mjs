import assert from "node:assert/strict";
import test from "node:test";
import { buildOpeningTimeline, projectOpeningTimeline, openingFocusBoundary, openingTrace, openingEvidenceBoundaries, visibleOpeningLines } from "./openingTimeline.ts";

const event = (id, children = [], opening) => ({component:id, name:`${id}.md`, file:`events/${id}.md`, children, opening, content:{sha256:"test",bytes:0}});
const change = (predecessors, successors) => ({predecessors, successors});
const graph = (events) => ({events, documents:["a","b","c","untouched"].map(component=>({component,path:`files/${component}.md`})), historical_components:{old:{path:"former/old.md"}}});
const opening = (...ids) => ({files:ids.map(component=>({component,path:`files/${component}.md`}))});
const events = [event("summary",["start","nested"]), event("start",[],change([], ["a"])),
  event("nested",["split","discussion","merge"]), event("split",[],change(["a"],["b","c"])),
  event("discussion"), event("merge",[],change(["b","c"],["a"]))];

test("folding a summary composes file boundaries and hides internal-only lifelines", () => {
  const folded=buildOpeningTimeline(graph(events),opening("a"),new Set());
  assert.deepEqual(folded.points.map(p=>p.event.component),["summary"]);
  assert.deepEqual(folded.points[0].predecessors,[]);
  assert.deepEqual(folded.points[0].successors,["a"]);
  assert.deepEqual(folded.files.map(f=>f.component),["a"]);
  const expanded=buildOpeningTimeline(graph(events),opening("a"),new Set(["summary","nested"]));
  assert.deepEqual(expanded.points.map(p=>p.event.component),["summary","start","nested","split","discussion","merge"]);
  assert.deepEqual(expanded.files.map(f=>f.component),["a","b","c"]);
  assert.deepEqual([...expanded.final],["a"]);
  assert.deepEqual([...folded.final],["a"]);
  assert.ok(expanded.lines.some(line=>line.component==="b"&&line.kind==="predecessor"));
  assert.equal(expanded.byId.get("discussion").junctionY,undefined);
});

test("nested folding preserves the carried file and its outer context", () => {
  const outer=buildOpeningTimeline(graph(events),opening("a"),new Set(["summary"]));
  assert.deepEqual(outer.points.map(p=>p.event.component),["summary","start","nested"]);
  assert.deepEqual(outer.byId.get("nested").predecessors,["a"]);
  assert.deepEqual(outer.byId.get("nested").successors,["a"]);
  assert.equal(outer.files.length,1);
  assert.equal(outer.unrecorded,false);
});

test("a summary's own transition is applied once alongside child transitions", () => {
  const tree=[event("group",["child"],change([], ["a"])),event("child",[],change(["a"],["b"]))];
  for(const expanded of [new Set(),new Set(["group"])]) {
    const layout=buildOpeningTimeline(graph(tree),opening("b"),expanded);
    assert.deepEqual([...layout.final],["b"]);
    assert.equal(layout.unrecorded,false);
  }
});

test("partial history carries explicit predecessors without manufacturing current transitions", () => {
  const tree=[event("change",[],change(["old"],["a"]))];
  const layout=buildOpeningTimeline(graph(tree),opening("c"),new Set());
  assert.deepEqual([...layout.initial],["old"]);
  assert.equal(layout.fileById.get("old").managed,false);
  assert.equal(layout.fileById.get("old").path,"former/old.md");
  assert.equal(layout.unrecorded,true);
  assert.ok(layout.lines.some(line=>line.component==="c"&&line.kind==="current"));
  assert.ok(!layout.lines.some(line=>line.component==="c"&&line.kind!=="current"));
  assert.ok(!layout.lines.some(line=>line.component==="a"&&line.kind==="current"));
});

test("current Opening and discussion-only projects remain independently readable", () => {
  const layout=buildOpeningTimeline(graph([event("thought")]),opening("untouched"),new Set());
  assert.equal(layout.points.length,1);
  assert.equal(layout.lines.length,1);
  assert.equal(layout.lines[0].kind,"current");
  assert.equal(buildOpeningTimeline(graph([]),opening("a"),new Set()).files.length,1);
});

test("viewport culling retains crossing lifelines in a dense authored history", () => {
  const many=[event("start",[],change([], ["a"])),...Array.from({length:4094},(_,i)=>event(`d${i}`)),event("end",[],change(["a"],[]))];
  const layout=buildOpeningTimeline(graph(many),opening(),new Set());
  const visible=visibleOpeningLines(layout.lines,20000,0,900,500);
  assert.equal(visible.length,1);
  assert.equal(visible[0].component,"a");
  assert.equal(visible[0].kind,"span");
  assert.deepEqual(visibleOpeningLines(layout.lines,20000,1000,900,500),[]);
});


test("retired lanes are reused and the focused rail shows only that historical selection", () => {
  const tree = [event("start", [], change([], ["a"])), event("second", [], change(["a"], ["b"])), event("third", [], change(["b"], ["c"]))];
  const topology = buildOpeningTimeline(graph(tree), opening("c"), new Set());
  assert.equal(topology.trackCount, 1);
  for (const [index, id] of ["a", "b", "c"].entries()) {
    const view = projectOpeningTimeline(topology, index + 1);
    assert.deepEqual(view.files.map(file => file.component), [id]);
    assert.equal(view.files[0].lane, 0);
  }
  assert.equal(openingFocusBoundary(topology, topology.points[1].x), 2);
  assert.equal(openingFocusBoundary(topology, topology.presentX), 4);
});

test("unrecorded current reentry gets a distinct interval and appears only at Now", () => {
  const topology = buildOpeningTimeline(graph([event("retire", [], change(["a"], []))]), opening("a"), new Set());
  assert.equal(topology.intervals.length, 2);
  assert.equal(topology.intervalById.size, 2);
  assert.equal(projectOpeningTimeline(topology, 1).files.length, 0);
  assert.equal(projectOpeningTimeline(topology, 2).files[0].component, "a");
  assert.ok(!topology.lines.some(line => line.interval === topology.intervals[1].id && line.kind !== "current"));
});

test("authored Event names cannot collide with initial and present interval identities", () => {
  const topology = buildOpeningTimeline(graph([event("initial", [], change(["a"], ["a"]))]), opening("a"), new Set());
  assert.equal(topology.intervals.length, 2);
  assert.equal(topology.intervalById.size, 2);
  assert.equal(openingTrace(topology, {kind:"file", component:"a", interval:topology.intervals[1].id}).intervals.size, 2);
});

test("hover previews a local span while selection follows its branching history", () => {
  const topology = buildOpeningTimeline(graph(events), opening("a"), new Set(["summary", "nested"]));
  const interval = topology.intervals.find(interval => interval.from === "merge").id;
  const target = {kind:"file", component:"a", interval};
  const hover = openingTrace(topology, target, true);
  assert.deepEqual([...hover.files], ["a"]);
  assert.equal(hover.events.has("merge"), true);
  const selected = openingTrace(topology, target);
  assert.deepEqual([...selected.files].sort(), ["a", "b", "c"]);
  assert.equal(selected.events.has("split"), true);
  assert.equal(openingTrace(topology, {kind:"event", component:"summary"}).events.has("merge"), true);
  const folded = buildOpeningTimeline(graph(events), opening("a"), new Set());
  assert.equal(openingTrace(folded, target).events.has("summary"), true, "file selection follows its composed interval after folding");
});

test("evidence positions respect authored order and do not pin inside hidden summaries", () => {
  const folded = buildOpeningTimeline(graph(events), opening("a"), new Set());
  assert.equal(openingEvidenceBoundaries(folded).positions[2], undefined);
  const expanded = buildOpeningTimeline(graph(events), opening("a"), new Set(["summary", "nested"]));
  assert.equal(openingEvidenceBoundaries(expanded).positions[2], expanded.byId.get("start").x);
  const reordered = buildOpeningTimeline(graph([events[0], events[2], events[1], ...events.slice(3)]), opening("a"), new Set(["summary", "nested"]));
  assert.equal(openingEvidenceBoundaries(reordered).positions[2], undefined);
});

test("selection can traverse a long lineage without recursive stack growth", () => {
  const tree = Array.from({length:4096}, (_, i) => event(`e${i}`, [], change(i ? ["a"] : [], ["a"])));
  const topology = buildOpeningTimeline(graph(tree), opening("a"), new Set());
  const selected = openingTrace(topology, {kind:"file", component:"a", interval:topology.intervals.at(-1).id});
  assert.equal(selected.intervals.size, 4096);
  assert.equal(topology.trackCount, 1);
});

test("scrolling reuses unchanged geometry while updating exact file intervals", () => {
  const tree = [event("start", [], change([], ["a", "b"])), event("continue", [], change(["b"], ["b"])),
    event("retire", [], change(["a"], [])), event("continue-again", [], change(["b"], ["b"]))];
  const topology = buildOpeningTimeline(graph(tree), opening("b"), new Set());
  const first = projectOpeningTimeline(topology, 1), next = projectOpeningTimeline(topology, 2);
  assert.equal(first.points, topology.points);
  assert.equal(first.lines, next.lines);
  assert.notEqual(first.files[1].interval, next.files[1].interval);
  const reordered = projectOpeningTimeline(topology, 3), later = projectOpeningTimeline(topology, 4);
  assert.notEqual(reordered.lines, first.lines);
  assert.equal(reordered.lines, later.lines);
  assert.equal(reordered.points, later.points);
  assert.notEqual(reordered.files[0].interval, later.files[0].interval);
  assert.equal(reordered.files[0].y, first.files[0].y);
  assert.equal(projectOpeningTimeline(topology, 1).lines, topology.lines);
  const rebuilt = buildOpeningTimeline(graph(tree), opening("b"), new Set());
  assert.notEqual(projectOpeningTimeline(rebuilt, 3).lines, reordered.lines);
});
