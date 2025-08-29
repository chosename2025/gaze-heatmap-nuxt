<script setup lang="ts">
import { UForm, UInput, UButton, UModal, UCard, UIcon } from '#components';
import { useWindowScroll, useWindowSize } from '@vueuse/core';

declare global {
  interface Window {
    webgazer: any;
  }
}

const webgazer = process.client ? window.webgazer : null;

useHead({
  script: [{ src: 'https://webgazer.cs.brown.edu/webgazer.js' }]
})

enum TrackingSteps {
  Initial = 1,
  Tracking = 3,
  Results = 4
}

interface Point {
  x: number,
  y: number
}

const currentStep = ref<TrackingSteps>(TrackingSteps.Initial);
const currentSite = ref<string>('https://gpudc.ru/');
const currentSiteImage = ref<string>('');
const currentTime = ref<number>(30);
const currentTimeLeft = ref<number>(currentTime.value);
const currentResultsImage = ref<string>('');
const isLoading = ref<boolean>(false);

const iframeRef = ref<HTMLIFrameElement | null>(null);
const { x, y } = useWindowScroll();
const { width: windowWidth, height: windowHeight } = useWindowSize();

let results: Point[] = [];

async function startTracking() {
  if (currentStep.value !== TrackingSteps.Initial) {
    throw new Error(`Cannot start tracking in step ${currentStep}`)
  }

  isLoading.value = true;

  const screenshot = await $fetch('/api/render-web-page', {
    body: {
      url: currentSite.value,
      width: windowWidth.value,
      height: 10000,
    },
    method: 'POST',
  });

  currentSiteImage.value = (screenshot as any).screenshot;

  currentStep.value = TrackingSteps.Tracking;

  isLoading.value = false;

  webgazer.setTracker("TFFacemesh");

  webgazer.setGazeListener(function(data: any, elapsedTime: any) {
    if (data == null) {
      return;
    }
    results.push({
      x: data.x,
      y: data.y + y.value
    })
  }).begin();

  setTimeout(() => {
    if (currentStep.value === TrackingSteps.Tracking) {
      currentStep.value = TrackingSteps.Results;
      webgazer.end();

      $fetch('/api/render-web-page', {
        body: {
          url: currentSite.value,
          width: windowWidth.value,
          height: 10000,
          points: results
        },
        method: 'POST',
      }).then((res: any) => {
        currentResultsImage.value = res.screenshot;
      })
    }
  }, 1000 * currentTime.value)

  currentTimeLeft.value = currentTime.value;

  const interval = setInterval(() => {
    if(currentTimeLeft.value > 0) {
      currentTimeLeft.value -= 1;
    } else {
      clearInterval(interval);
    }
  }, 1000)
}

function downloadHeatmap() {
  const link = document.createElement('a');
  link.href = `data:image/png;base64,${currentResultsImage.value}`;
  link.download = 'heatmap.png';
  link.click();
}

const stats = computed(() => ({
  totalPoints: results.length,
  uniqueAreas: new Set(results.map(p => `${Math.floor(p.x / 100)}-${Math.floor(p.y / 100)}`)).size,
  trackingDuration: currentTime.value,
}));
</script>

<template>
  <div class="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6">
    <div v-if="currentStep === TrackingSteps.Initial && !isLoading" class="w-full max-w-lg">
      <UCard class="bg-gray-800 shadow-2xl border border-gray-700 rounded-xl overflow-hidden">
        <template #header>
          <h2 class="text-3xl font-extrabold text-gray-100 px-6 py-4 border-b border-gray-700">Настройка отслеживания</h2>
        </template>
        <UForm class="space-y-6 p-6">
          <UInput 
            v-model="currentSite" 
            label="URL сайта" 
            placeholder="Введите полный URL сайта" 
            class="w-full text-gray-100 bg-gray-700 border-gray-600 focus:border-gray-400"
            size="lg"
            icon="i-heroicons-globe-alt"
          />
          <UInput 
            v-model="currentTime" 
            label="Время отслеживания (сек)" 
            placeholder="Введите время в секундах" 
            type="number"
            class="w-full text-gray-100 bg-gray-700 border-gray-600 focus:border-gray-400"
            size="lg"
            icon="i-heroicons-clock"
          />
          <UButton 
            @click="startTracking" 
            size="lg" 
            block
            class="mt-6 bg-gray-700 hover:bg-gray-600 text-gray-100 font-semibold"
          >
            Начать отслеживание
          </UButton>
        </UForm>
      </UCard>
    </div>

    <div v-if="isLoading" class="w-full">
      <div class="flex justify-center items-center min-h-screen w-full">
        <div class="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-gray-400"></div>
      </div>
    </div>

    <div v-if="currentStep === TrackingSteps.Tracking" ref="iframeRef" class="w-full">
      <div class="flex justify-center items-center min-h-screen">
        <div class="relative">
          <img :src="`data:image/png;base64,${currentSiteImage}`" class="w-full h-full object-contain" />
          <div class="absolute top-4 right-4 bg-gray-700 text-gray-100 px-4 py-2 rounded-lg shadow-md">
            Отслеживание: {{ currentTimeLeft }} сек
          </div>
        </div>
      </div>
    </div>

    <div v-if="currentStep === TrackingSteps.Results" class="w-full max-w-5xl">
      <UCard class="bg-gray-800 shadow-2xl border border-gray-700 rounded-xl overflow-hidden">
        <template #header>
          <div class="flex justify-between items-center px-6 py-4 border-b border-gray-700">
            <h2 class="text-3xl font-extrabold text-gray-100">Результаты</h2>
            <div class="space-x-3">
              <UModal> 
                <UButton class="bg-gray-700 hover:bg-gray-600 text-gray-100">
                <UIcon name="i-heroicons-chart-bar" class="mr-2" />
                Статистика
              </UButton>
              <template #content>
                <UCard class="bg-gray-800 border border-gray-700 rounded-lg">
          <template #header>
            <h3 class="text-xl font-bold text-gray-100">Статистика отслеживания</h3>
          </template>
          <div class="space-y-4 p-6 text-gray-300 text-lg">
            <div class="flex justify-between">
              <span>Общее количество точек:</span>
              <span class="font-semibold">{{ stats.totalPoints }}</span>
            </div>
            <div class="flex justify-between">
              <span>Уникальные зоны активности:</span>
              <span class="font-semibold">{{ stats.uniqueAreas }}</span>
            </div>
            <div class="flex justify-between">
              <span>Длительность отслеживания:</span>
              <span class="font-semibold">{{ stats.trackingDuration }} сек</span>
            </div>
          </div>
        </UCard>
              </template>

              </UModal>
              
              <UButton @click="downloadHeatmap" class="bg-gray-700 hover:bg-gray-600 text-gray-100">
                <UIcon name="lucide:download" class="mr-2" />
                Скачать
              </UButton>
            </div>
          </div>
        </template>
        <div class="p-6">
          <div v-if="!currentResultsImage" class="flex justify-center items-center h-96">
            <div class="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-gray-400"></div>
          </div>
          <img 
            v-else
            :src="`data:image/png;base64,${currentResultsImage}`" 
            class="w-full rounded-lg shadow-inner"
          />
        </div>
      </UCard>
    </div>
  </div>
</template>

<style scoped>
.min-h-screen {
  background: linear-gradient(to bottom right, #0a0a0a, #1a1a1a);
}
</style>