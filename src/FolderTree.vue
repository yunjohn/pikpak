<script setup>
defineOptions({name:'FolderTree'});
const props=defineProps({nodes:{type:Array,default:()=>[]},children:{type:Object,required:true},expanded:{type:Array,required:true},currentId:{type:String,default:''},path:{type:Array,default:()=>[]}});
const emit=defineEmits(['toggle','open']);
function childNodes(id){return props.children[id]||[]}
</script>

<template>
  <div class="folder-tree">
    <div v-for="node in nodes" :key="node.id" class="folder-branch">
      <div :class="['folder-node',{active:currentId===node.id}]">
        <button class="tree-toggle" :title="expanded.includes(node.id)?'收起':'展开'" @click.stop="emit('toggle',node)">{{expanded.includes(node.id)?'▾':'▸'}}</button>
        <button class="tree-label" @click="emit('open',{node,path:[...path,node]})">📁 <span>{{node.name}}</span></button>
      </div>
      <FolderTree v-if="expanded.includes(node.id)" :nodes="childNodes(node.id)" :children="children" :expanded="expanded" :current-id="currentId" :path="[...path,node]" @toggle="emit('toggle',$event)" @open="emit('open',$event)" />
    </div>
  </div>
</template>
