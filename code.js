// ==UserScript==
// @name         GeoFS Autofocus System
// @namespace    geofs-dof
// @version      0.1
// @description  Focus
// @match        *://www.geo-fs.com/*
// @grant        none
// @author       TOMAIIM(SandWolfShirak）
// ==/UserScript==


(function () {
    'use strict';

    let viewer = null;
    let dofStage = null;

    let focusDistance = 0.2;
    let targetFocus = 0.2;
    let lastUpdate = 0;

    let DOF_ENABLED = true;

    function init(v) {
        viewer = v;
        console.log("[DOF] INIT");

        if (dofStage && !dofStage.isDestroyed()) {
            viewer.scene.postProcessStages.remove(dofStage);
        }

        dofStage = new Cesium.PostProcessStage({
            name: "DOF_ULTIMATE",
            fragmentShader: `
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D colorTexture;
uniform sampler2D depthTexture;

#if __VERSION__ == 300
    in vec2 v_textureCoordinates;
    out vec4 fragColor;
    #define TEX texture
#else
    varying vec2 v_textureCoordinates;
    #define TEX texture2D
#endif

uniform float focusDistance;

// ✔️Fix: Remove czm_unpackDepth and correct type
float getDepth(vec2 uv) {
    return TEX(depthTexture, uv).r;
}

void main() {
    float depth = getDepth(v_textureCoordinates);

    float nearBlur = clamp((focusDistance - depth) * 6.0, 0.0, 1.0);
    float farBlur = clamp((depth - focusDistance) * 3.5, 0.0, 1.0);
    float blur = max(nearBlur * 0.4, farBlur);

    vec4 col = vec4(0.0);
    float total = 0.0;

    for (int x = -3; x <= 3; x++) {
        for (int y = -3; y <= 3; y++) {
            vec2 offset = vec2(float(x), float(y)) / 1000.0;
            float dist = length(vec2(x, y));
            float weight = exp(-dist * dist * 0.3);

            col += TEX(colorTexture, v_textureCoordinates + offset * blur) * weight;
            total += weight;
        }
    }

    col /= total;

    vec4 sharp = TEX(colorTexture, v_textureCoordinates);

// ✔️Fix WebGL1 / WebGL2 output
#if __VERSION__ == 300
    fragColor = mix(sharp, col, blur);
#else
    gl_FragColor = mix(sharp, col, blur);
#endif
}
            `,
            uniforms: {
                focusDistance: () => focusDistance
            }
        });

        viewer.scene.postProcessStages.add(dofStage);

        setupControls();
        setupToggle();
    }

    function setupControls() {
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);

        handler.setInputAction(function (click) {
            if (!DOF_ENABLED) return;

            const picked = viewer.scene.pickPosition(click.position);
            if (picked) {
                const cam = viewer.camera.positionWC;
                const dist = Cesium.Cartesian3.distance(cam, picked);
                targetFocus = Cesium.Math.clamp(dist / 5000.0, 0.05, 0.5);
                console.log("[DOF] Click focus:", targetFocus);
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }

    function setupToggle() {
        window.addEventListener("keydown", (e) => {
            if (e.key.toLowerCase() === "d") {
                DOF_ENABLED = !DOF_ENABLED;

                if (dofStage) {
                    dofStage.enabled = DOF_ENABLED;
                }

                showStatus();
                console.log("[DOF] Toggle:", DOF_ENABLED);
            }
        });
    }

    function showStatus() {
        let el = document.getElementById("dof-status");
        if (!el) {
            el = document.createElement("div");
            el.id = "dof-status";
            el.style.position = "fixed";
            el.style.top = "20px";
            el.style.right = "20px";
            el.style.padding = "8px 14px";
            el.style.background = "rgba(0,0,0,0.6)";
            el.style.color = "#fff";
            el.style.fontSize = "14px";
            el.style.borderRadius = "8px";
            el.style.zIndex = 9999;
            document.body.appendChild(el);
        }

        el.textContent = DOF_ENABLED ? "DOF: ON" : "DOF: OFF";
        el.style.opacity = "1";

        setTimeout(() => {
            el.style.opacity = "0";
        }, 1200);
    }

    function autoFocus() {
        if (!DOF_ENABLED) return;

        const cam = viewer.camera;
        const fov = cam.frustum.fov || 0.8;

        let auto = Cesium.Math.clamp(fov / 1.2, 0.08, 0.3);

        if (cam.positionCartographic.height < 50) {
            auto = 0.12;
        }

        targetFocus = targetFocus * 0.7 + auto * 0.3;
    }

    function smoothFocus() {
        if (!DOF_ENABLED) return;

        focusDistance += (targetFocus - focusDistance) * 0.08;
    }

    function loop() {
        if (!viewer) return;

        const now = performance.now();

        if (now - lastUpdate > 100) {
            autoFocus();
            lastUpdate = now;
        }

        smoothFocus();
        requestAnimationFrame(loop);
    }

    function watch() {
        if (!geofs || !geofs.api || !geofs.api.viewer) {
            requestAnimationFrame(watch);
            return;
        }

        if (viewer !== geofs.api.viewer) {
            console.log("[DOF] Viewer changed → rebuild");
            init(geofs.api.viewer);
        }

        if (viewer && dofStage) {
            const stages = viewer.scene.postProcessStages;
            if (!stages.contains(dofStage)) {
                console.log("[DOF] lost → restore");
                init(viewer);
            }
        }

        requestAnimationFrame(watch);
    }

    watch();
    loop();

})();
