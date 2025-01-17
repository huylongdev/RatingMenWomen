import "./styles.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { BufferGeometryUtils } from "three/examples/jsm/utils/BufferGeometryUtils";
import * as TWEEN from "@tweenjs/tween.js";

class TweenManger {
  constructor() {
    this.numTweensRunning = 0;
  }
  _handleComplete() {
    --this.numTweensRunning;
    console.assert(this.numTweensRunning >= 0); /* eslint no-console: off */
  }
  createTween(targetObject) {
    const self = this;
    ++this.numTweensRunning;
    let userCompleteFn = () => {};
    // create a new tween and install our own onComplete callback
    const tween = new TWEEN.Tween(targetObject).onComplete(function (...args) {
      self._handleComplete();
      userCompleteFn.call(this, ...args);
    });
    // replace the tween's onComplete function with our own
    // so we can call the user's callback if they supply one.
    tween.onComplete = (fn) => {
      userCompleteFn = fn;
      return tween;
    };
    return tween;
  }
  update() {
    TWEEN.update();
    return this.numTweensRunning > 0;
  }
}

function main() {
  const canvas = document.querySelector("#c");
  const renderer = new THREE.WebGLRenderer({ canvas });
  const tweenManager = new TweenManger();

  const fov = 60;
  const aspect = 2; // the canvas default
  const near = 0.1;
  const far = 10;
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(4, 0, 0);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.5;
  controls.maxDistance = 3;
  controls.update();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("black");

  {
    const loader = new THREE.TextureLoader();
    const texture = loader.load("../assets/world.jpg", render);
    const geometry = new THREE.SphereGeometry(1, 64, 32);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = Math.PI * -0.5; // to look at Europe initially
    scene.add(mesh);

    const atmosphereShader = {
      uniforms: {},
      vertexShader: [
        "varying vec3 vNormal;",
        "void main() {",
        "vNormal = normalize( normalMatrix * normal );",
        "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
        "}"
      ].join("\n"),
      fragmentShader: [
        "varying vec3 vNormal;",
        "void main() {",
        "float intensity = pow( 0.8 - dot( vNormal, vec3( 0, 0, 1.0 ) ), 12.0 );",
        "gl_FragColor = vec4( 1.0, 1.0, 1.0, 1.0 ) * intensity;",
        "}"
      ].join("\n")
    };

    const uniforms = THREE.UniformsUtils.clone(atmosphereShader.uniforms);

    const atmosphereGeometry = new THREE.SphereGeometry(1.07, 40, 30);
    const atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: atmosphereShader.vertexShader,
      fragmentShader: atmosphereShader.fragmentShader,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true
    });

    const atmosphereMesh = new THREE.Mesh(
      atmosphereGeometry,
      atmosphereMaterial
    );
    atmosphereMesh.scale.set(1.1, 1.1, 1.1);
    scene.add(atmosphereMesh);
  }

  async function loadFile(url) {
    const req = await fetch(url);
    return req.text();
  }

  function parseData(text) {
    const data = [];
    const settings = { data };
    let max;
    let min;
    // split into lines
    text.split("\n").forEach((line) => {
      // split the line by whitespace
      const parts = line.trim().split(/\s+/);
      if (parts.length === 2) {
        // only 2 parts, must be a key/value pair
        settings[parts[0]] = parseFloat(parts[1]);
      } else if (parts.length > 2) {
        // more than 2 parts, must be data
        const values = parts.map((v) => {
          const value = parseFloat(v);
          if (value === settings.NODATA_value) {
            return undefined;
          }
          max = Math.max(max === undefined ? value : max, value);
          min = Math.min(min === undefined ? value : min, value);
          return value;
        });
        data.push(values);
      }
    });
    return Object.assign(settings, { min, max });
  }

  function dataMissingInAnySet(fileInfos, latNdx, lonNdx) {
    for (const fileInfo of fileInfos) {
      if (fileInfo.file.data[latNdx][lonNdx] === undefined) {
        return true;
      }
    }
    return false;
  }

  function makeBoxes(file, hueRange, fileInfos) {
    const { min, max, data } = file;
    const range = max - min;

    // these helpers will make it easy to position the boxes
    // We can rotate the lon helper on its Y axis to the longitude
    const lonHelper = new THREE.Object3D();
    scene.add(lonHelper);
    // We rotate the latHelper on its X axis to the latitude
    const latHelper = new THREE.Object3D();
    lonHelper.add(latHelper);
    // The position helper moves the object to the edge of the sphere
    const positionHelper = new THREE.Object3D();
    positionHelper.position.z = 1;
    latHelper.add(positionHelper);
    // Used to move the center of the cube so it scales from the position Z axis
    const originHelper = new THREE.Object3D();
    originHelper.position.z = 0.5;
    positionHelper.add(originHelper);

    const color = new THREE.Color();

    const lonFudge = Math.PI * 0.5;
    const latFudge = Math.PI * -0.135;
    const geometries = [];
    data.forEach((row, latNdx) => {
      row.forEach((value, lonNdx) => {
        if (dataMissingInAnySet(fileInfos, latNdx, lonNdx)) {
          return;
        }
        const amount = (value - min) / range;

        const boxWidth = 1;
        const boxHeight = 1;
        const boxDepth = 1;
        const geometry = new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth);

        // adjust the helpers to point to the latitude and longitude
        lonHelper.rotation.y =
          THREE.MathUtils.degToRad(lonNdx + file.xllcorner) + lonFudge;
        latHelper.rotation.x =
          THREE.MathUtils.degToRad(latNdx + file.yllcorner) + latFudge;

        // use the world matrix of the origin helper to
        // position this geometry
        positionHelper.scale.set(
          0.005,
          0.005,
          THREE.MathUtils.lerp(0.01, 0.5, amount)
        );
        originHelper.updateWorldMatrix(true, false);
        geometry.applyMatrix4(originHelper.matrixWorld);

        // compute a color
        const hue = THREE.MathUtils.lerp(...hueRange, amount);
        const saturation = 1;
        const lightness = THREE.MathUtils.lerp(0.4, 1.0, amount);
        color.setHSL(hue, saturation, lightness);
        // get the colors as an array of values from 0 to 255
        const rgb = color.toArray().map((v) => v * 255);

        // make an array to store colors for each vertex
        const numVerts = geometry.getAttribute("position").count;
        const itemSize = 3; // r, g, b
        const colors = new Uint8Array(itemSize * numVerts);

        // copy the color into the colors array for each vertex
        colors.forEach((v, ndx) => {
          colors[ndx] = rgb[ndx % 3];
        });

        const normalized = true;
        const colorAttrib = new THREE.BufferAttribute(
          colors,
          itemSize,
          normalized
        );
        geometry.setAttribute("color", colorAttrib);

        geometries.push(geometry);
      });
    });

    return BufferGeometryUtils.mergeBufferGeometries(geometries, false);
  }

  async function loadData(info) {
    const text = await loadFile(info.url);
    info.file = parseData(text);
  }

  async function loadAll() {
    const fileInfos = [
      {
        name: "women",
        hueRange: [0.9, 1.1],
        url:
          "../data/gpw_v4_basic_demographic_characteristics_rev10_a000_014ft_2010_cntm_1_deg.asc"
      },
      {
        name: "men",
        hueRange: [0.7, 0.3],
        url:
          "../data/gpw_v4_basic_demographic_characteristics_rev10_a000_014mt_2010_cntm_1_deg.asc"
      }
    ];

    await Promise.all(fileInfos.map(loadData));

    function mapValues(data, fn) {
      return data.map((row, rowNdx) => {
        return row.map((value, colNdx) => {
          return fn(value, rowNdx, colNdx);
        });
      });
    }

    function makeDiffFile(baseFile, otherFile, compareFn) {
      let min;
      let max;
      const baseData = baseFile.data;
      const otherData = otherFile.data;
      const data = mapValues(baseData, (base, rowNdx, colNdx) => {
        const other = otherData[rowNdx][colNdx];
        if (base === undefined || other === undefined) {
          return undefined;
        }
        const value = compareFn(base, other);
        min = Math.min(min === undefined ? value : min, value);
        max = Math.max(max === undefined ? value : max, value);
        return value;
      });
      // make a copy of baseFile and replace min, max, and data
      // with the new data
      return { ...baseFile, min, max, data };
    }

    // generate a new set of data
    {
      const menInfo = fileInfos[0];
      const womenInfo = fileInfos[1];
      const menFile = menInfo.file;
      const womenFile = womenInfo.file;

      function amountGreaterThan(a, b) {
        return Math.max(a - b, 0);
      }
      fileInfos.push({
        name: "women > men",
        hueRange: [0.0, 0.4],
        file: makeDiffFile(womenFile, menFile, (women, men) => {
          return amountGreaterThan(women, men);
        })
      });
      fileInfos.push({
        name: "men > women",
        hueRange: [0.6, 1.1],
        file: makeDiffFile(menFile, womenFile, (men, women) => {
          return amountGreaterThan(men, women);
        })
      });
    }

    // make geometry for each data set
    const geometries = fileInfos.map((info) => {
      return makeBoxes(info.file, info.hueRange, fileInfos);
    });

    // use the first geometry as the base
    // and add all the geometries as morphtargets
    const baseGeometry = geometries[0];
    baseGeometry.morphAttributes.position = geometries.map((geometry, ndx) => {
      const attribute = geometry.getAttribute("position");
      // why?
      const name = `target${ndx}`;
      attribute.name = name;
      return attribute;
    });
    const colorAttributes = geometries.map((geometry, ndx) => {
      const attribute = geometry.getAttribute("color");
      // why? name?
      const name = `morphColor${ndx}`;
      attribute.name = `color${ndx}`; // just for debugging
      return { name, attribute };
    });

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      morphTargets: true
    });

    const vertexShaderReplacements = [
      {
        from: "#include <morphtarget_pars_vertex>",
        to: `
          uniform float morphTargetInfluences[8];
        `
      },
      {
        from: "#include <morphnormal_vertex>",
        to: `
        `
      },
      {
        from: "#include <morphtarget_vertex>",
        to: `
          transformed += (morphTarget0 - position) * morphTargetInfluences[0];
          transformed += (morphTarget1 - position) * morphTargetInfluences[1];
          transformed += (morphTarget2 - position) * morphTargetInfluences[2];
          transformed += (morphTarget3 - position) * morphTargetInfluences[3];
        `
      },
      {
        from: "#include <color_pars_vertex>",
        to: `
          varying vec3 vColor;
          attribute vec3 morphColor0;
          attribute vec3 morphColor1;
          attribute vec3 morphColor2;
          attribute vec3 morphColor3;
        `
      },
      {
        from: "#include <color_vertex>",
        to: `
          vColor.xyz = morphColor0 * morphTargetInfluences[0] +
                       morphColor1 * morphTargetInfluences[1] +
                       morphColor2 * morphTargetInfluences[2] +
                       morphColor3 * morphTargetInfluences[3];
        `
      }
    ];
    material.onBeforeCompile = (shader) => {
      vertexShaderReplacements.forEach((rep) => {
        shader.vertexShader = shader.vertexShader.replace(rep.from, rep.to);
      });
    };

    const mesh = new THREE.Mesh(baseGeometry, material);
    mesh.rotation.y = Math.PI * -0.5; // to look at Europe initially
    scene.add(mesh);

    function updateMorphTargets() {
      // remove all the color attributes
      for (const { name } of colorAttributes) {
        baseGeometry.deleteAttribute(name);
      }

      // three.js provides no way to query this so we have to guess and hope it doesn't change.
      const maxInfluences = 8;

      // three provides no way to query which morph targets it will use
      // nor which attributes it will assign them to so we'll guess.
      // If the algorithm in three.js changes we'll need to refactor this.
      mesh.morphTargetInfluences
        .map((influence, i) => [i, influence]) // map indices to influence
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])) // sort by highest influence first
        .slice(0, maxInfluences) // keep only top influences
        .sort((a, b) => a[0] - b[0]) // sort by index
        .filter((a) => !!a[1]) // remove no influence entries
        .forEach(([ndx, influence], i) => {
          // assign the attributes
          const name = `morphColor${i}`;
          baseGeometry.setAttribute(name, colorAttributes[ndx].attribute);
        });
    }

    // show the selected data, hide the rest
    function showFileInfo(fileInfos, fileInfo) {
      // why? repeat for target
      const targets = {};
      fileInfos.forEach((info, i) => {
        const visible = fileInfo === info;
        if (visible) info.elem.classList.add("active");
        else info.elem.classList.remove("active");
        targets[i] = visible ? 1 : 0;
      });
      const durationInMs = 500;
      tweenManager
        .createTween(mesh.morphTargetInfluences)
        .to(targets, durationInMs)
        .start();

      requestRenderIfNotRequested();
    }

    const uiElem = document.querySelector("#list");
    fileInfos.forEach((info) => {
      const li = document.createElement("li");
      info.elem = li;
      li.textContent = info.name;
      li.classList.add("year");
      uiElem.appendChild(li);
      function show() {
        showFileInfo(fileInfos, info);
      }
      li.addEventListener("click", show);
    });
    // show the first set of data
    showFileInfo(fileInfos, fileInfos[0]);

    return updateMorphTargets;
  }

  // use a no-op update function until the data is ready
  let updateMorphTargets = () => {};
  loadAll().then((fn) => {
    updateMorphTargets = fn;
  });

  function resizeRendererToDisplaySize(renderer) {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
    }
    return needResize;
  }

  let renderRequested = false;

  function render() {
    renderRequested = undefined;

    if (resizeRendererToDisplaySize(renderer)) {
      const canvas = renderer.domElement;
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
    }

    // why? what if after `render`?
    if (tweenManager.update()) {
      requestRenderIfNotRequested();
    }

    updateMorphTargets();

    controls.update();
    renderer.render(scene, camera);
  }
  render();

  function requestRenderIfNotRequested() {
    if (!renderRequested) {
      renderRequested = true;
      requestAnimationFrame(render);
    }
  }

  controls.addEventListener("change", requestRenderIfNotRequested);
  window.addEventListener("resize", requestRenderIfNotRequested);
}

main();
