interface Window {
    ManagedMediaSource: any;
}

enum LogLevel {
    ERROR = 0,
    WARN,
    INFO,
    DEBUG,
    TRACE,
}

let log_pre: HTMLPreElement;
let log_level: LogLevel = LogLevel.ERROR;
let no_log_messages: boolean = true;

let fps_out: HTMLOutputElement;
let frame_count = 0;
let last_fps_calc: number = performance.now();

let check_video: HTMLInputElement;

// Stored settings. Renamed from "settings" so the tablet build starts from its own defaults
// instead of settings saved by older Weylus versions on the same address.
const SETTINGS_KEY = "settings_tablet_v1";

function run(level: string) {
    window.onload = () => {
        log_pre = document.getElementById("log") as HTMLPreElement;
        log_pre.textContent = "";
        log_level = LogLevel[level];
        fps_out = document.getElementById("fps") as HTMLOutputElement;
        check_video = document.getElementById("enable_video") as HTMLInputElement;
        window.addEventListener("error", (e: ErrorEvent | Event | UIEvent) => {
            if ((e as ErrorEvent).error) {
                let err = e as ErrorEvent;
                log(LogLevel.ERROR, err.filename + ":L" + err.lineno + ":" + err.colno + ": " + err.message + " Error object: " + JSON.stringify(err.error));
            } else if ((e as Event | UIEvent).target) {
                let ev = e as Event;
                let src = (e.target as any).src;
                if (ev.target instanceof HTMLVideoElement)
                    log(LogLevel.ERROR, "Failed to decode video, try reducing resolution or disabling hardware acceleration and reload the page. Error src: " + src);
                else
                    log(LogLevel.ERROR, "Failed to obtain resource, target: " + ev.target + " type: " + ev.type + " src: " + src + " Error object: " + JSON.stringify(ev));
            } else {
                log(LogLevel.WARN, "Got unknown event: " + JSON.stringify(e));
            }
            return false;
        }, true)
        init();
    };
}

function log(level: LogLevel, msg: string) {
    if (level > log_level)
        return;

    if (level == LogLevel.TRACE)
        console.trace(msg);
    else if (level == LogLevel.DEBUG)
        console.debug(msg);
    else if (level == LogLevel.INFO)
        console.info(msg);
    else if (level == LogLevel.WARN)
        console.warn(msg);
    else if (level == LogLevel.ERROR)
        console.error(msg);

    if (no_log_messages) {
        no_log_messages = false;
        document.getElementById("log_section").classList.remove("hide");
    }
    log_pre.textContent += LogLevel[level] + ": " + msg + "\n";
}

function frame_rate_scale(x: number) {
    return Math.pow(x / 100, 1.5);
}

function frame_rate_scale_inv(x: number) {
    return 100 * Math.pow(x, 2 / 3);
}


function calc_max_video_resolution(scale: number) {
    return [
        Math.round(scale * window.innerWidth * window.devicePixelRatio),
        Math.round(scale * window.innerHeight * window.devicePixelRatio)
    ];
}

function fresh_canvas() {
    let canvas_old = document.getElementById("canvas");
    let canvas = document.createElement("canvas");
    canvas.id = canvas_old.id;
    canvas_old.classList.forEach((cls) => canvas.classList.add(cls));
    canvas_old.replaceWith(canvas);
    return canvas;
}

class Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

class CustomInputAreas {
    mouse: Rect;
    touch: Rect;
    pen: Rect;
}

class Settings {
    webSocket: WebSocket;
    checks: Map<string, HTMLInputElement>;
    capturable_select: HTMLSelectElement;
    frame_rate_input: HTMLInputElement;
    frame_rate_output: HTMLOutputElement;
    scale_video_input: HTMLInputElement;
    scale_video_output: HTMLOutputElement;
    range_min_pressure: HTMLInputElement;
    check_aggressive_seek: HTMLInputElement;
    client_name_input: HTMLInputElement;
    visible: boolean;
    custom_input_areas: CustomInputAreas;
    settings: HTMLElement;

    constructor(webSocket: WebSocket) {
        this.webSocket = webSocket;
        this.checks = new Map<string, HTMLInputElement>();
        this.capturable_select = document.getElementById("window") as HTMLSelectElement;
        this.frame_rate_input = document.getElementById("frame_rate") as HTMLInputElement;
        this.frame_rate_input.min = frame_rate_scale_inv(0).toString();
        this.frame_rate_input.max = frame_rate_scale_inv(120).toString();
        this.frame_rate_output = this.frame_rate_input.nextElementSibling as HTMLOutputElement;
        this.scale_video_input = document.getElementById("scale_video") as HTMLInputElement;
        this.scale_video_output = this.scale_video_input.nextElementSibling as HTMLOutputElement;
        this.range_min_pressure = document.getElementById("min_pressure") as HTMLInputElement;
        this.client_name_input = document.getElementById("client_name") as HTMLInputElement;
        this.frame_rate_input.oninput = () => {
            this.frame_rate_output.value = Math.round(frame_rate_scale(this.frame_rate_input.valueAsNumber)).toString();
        }
        this.scale_video_input.oninput = () => {
            let [w, h] = calc_max_video_resolution(this.scale_video_input.valueAsNumber)
            this.scale_video_output.value = w + "x" + h
        }
        this.visible = true;

        // Settings UI
        this.settings = document.getElementById("settings");
        this.settings.onclick = (e) => e.stopPropagation();
        let handle = document.getElementById("handle");

        // Settings elements
        this.settings.querySelectorAll("input[type=checkbox]").forEach(
            (elem, _key, _parent) => this.checks.set(elem.id, elem as HTMLInputElement)
        );

        this.load_settings();

        // event handling

        // client only
        handle.onclick = () => { this.toggle() };
        this.checks.get("lefty").onchange = (e) => {
            if ((e.target as HTMLInputElement).checked)
                this.settings.classList.add("lefty");
            else
                this.settings.classList.remove("lefty");
            this.save_settings();
        }

        document.getElementById("vanish").onclick = () => {
            this.settings.classList.add("vanish");
        }

        this.checks.get("stretch").onchange = () => {
            stretch_video();
            this.save_settings();
        };

        this.checks.get("enable_debug_overlay").onchange = (e) => {
            let enabled = (e.target as HTMLInputElement).checked;
            if (enabled) {
                debug_overlay.classList.remove("hide");
            } else {
                debug_overlay.classList.add("hide");
            }
            this.save_settings();
        };

        this.check_aggressive_seek = this.checks.get("aggressive_seeking");
        this.check_aggressive_seek.onchange = () => {
            this.save_settings();
        };

        this.checks.get("enable_video").onchange = (e) => {
            let enabled = (e.target as HTMLInputElement).checked;
            document.getElementById("video").classList.toggle("vanish", !enabled);
            document.getElementById("canvas").classList.toggle("vanish", enabled);
            this.save_settings();
            if (enabled) {
                this.webSocket.send('"ResumeVideo"');
            } else {
                this.webSocket.send('"PauseVideo"');
            }
        }

        let upd_pointer = () => {
            this.save_settings();
            new PointerHandler(this.webSocket);
        }
        this.checks.get("enable_mouse").onchange = upd_pointer;
        this.checks.get("enable_stylus").onchange = upd_pointer;
        this.checks.get("enable_touch").onchange = upd_pointer;
        this.checks.get("tablet_mode").onchange = () => {
            if (!this.checks.get("tablet_mode").checked && view_gestures)
                view_gestures.reset_view();
            upd_pointer();
        };

        this.checks.get("energysaving").onchange = (e) => {
            this.save_settings();
            this.toggle_energysaving((e.target as HTMLInputElement).checked);
        };

        this.checks.get("enable_custom_input_areas").onchange = () => {
            this.save_settings();
        };

        this.frame_rate_input.onchange = () => this.save_settings();
        this.range_min_pressure.onchange = () => this.save_settings();

        // server
        let upd_server_config = () => { this.save_settings(); this.send_server_config() };
        this.checks.get("uinput_support").onchange = upd_server_config;
        this.checks.get("capture_cursor").onchange = upd_server_config;
        this.scale_video_input.onchange = upd_server_config;
        this.client_name_input.onchange = upd_server_config;
        this.frame_rate_input.onchange = upd_server_config;

        document.getElementById("refresh").onclick = () => this.webSocket.send('"GetCapturableList"');
        document.getElementById("custom_input_areas").onclick = () => {
            this.webSocket.send('"ChooseCustomInputAreas"');
        };
        this.capturable_select.onchange = () => this.send_server_config();
    }

    send_server_config() {
        let config = new Object(null);
        config["capturable_id"] = Number(this.capturable_select.value);
        for (const key of [
            "uinput_support",
            "capture_cursor"])
            config[key] = this.checks.get(key).checked;
        let [w, h] = calc_max_video_resolution(this.scale_video_input.valueAsNumber);
        config["max_width"] = w;
        config["max_height"] = h;
        config["frame_rate"] = frame_rate_scale(this.frame_rate_input.valueAsNumber);
        if (this.client_name_input.value)
            config["client_name"] = this.client_name_input.value;
        this.webSocket.send(JSON.stringify({ "Config": config }));
    }

    save_settings() {
        let settings = Object(null);
        for (const [key, elem] of this.checks.entries())
            settings[key] = elem.checked;
        settings["frame_rate"] = frame_rate_scale(this.frame_rate_input.valueAsNumber).toString();
        settings["scale_video"] = this.scale_video_input.value;
        settings["min_pressure"] = this.range_min_pressure.value;
        settings["custom_input_areas"] = this.custom_input_areas;
        settings["client_name"] = this.client_name_input.value;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    load_settings() {
        let settings_string = localStorage.getItem(SETTINGS_KEY);
        if (settings_string === null) {
            // 60 fps by default: frames are only sent as fast as the link takes them (FrameAck),
            // so a higher rate lowers latency without piling up video on slow links.
            this.frame_rate_input.value = frame_rate_scale_inv(60).toString();
            this.frame_rate_output.value = (60).toString();
            let [w, h] = calc_max_video_resolution(this.scale_video_input.valueAsNumber)
            this.scale_video_output.value = w + "x" + h;
            return;
        }
        try {
            let settings = JSON.parse(settings_string);
            for (const [key, elem] of this.checks.entries()) {
                if (typeof settings[key] === "boolean")
                    elem.checked = settings[key];
            }
            let upd_limit = settings["frame_rate"];
            if (upd_limit)
                this.frame_rate_input.value = frame_rate_scale_inv(upd_limit).toString();
            else
                this.frame_rate_input.value = frame_rate_scale_inv(30).toString();
            this.frame_rate_output.value = Math.round(frame_rate_scale(this.frame_rate_input.valueAsNumber)).toString();

            let scale_video = settings["scale_video"];
            if (scale_video)
                this.scale_video_input.value = scale_video;
            let [w, h] = calc_max_video_resolution(this.scale_video_input.valueAsNumber);
            this.scale_video_output.value = w + "x" + h;

            let min_pressure = settings["min_pressure"];
            if (min_pressure)
                this.range_min_pressure.value = min_pressure;

            this.custom_input_areas = settings["custom_input_areas"];

            if (this.checks.get("lefty").checked) {
                this.settings.classList.add("lefty");
            }

            if (!this.checks.get("enable_video").checked || this.checks.get("energysaving").checked) {
                this.checks.get("enable_video").checked = false;
                if (this.checks.get("energysaving").checked)
                    this.checks.get("enable_video").disabled = true;
                document.getElementById("video").classList.add("vanish");
                document.getElementById("canvas").classList.remove("vanish");
            }

            if (this.checks.get("energysaving").checked) {
                this.toggle_energysaving(true);
            }

            if (this.checks.get("enable_debug_overlay").checked) {
                debug_overlay.classList.remove("hide");
            }


            if (document.getElementById("custom_input_areas").classList.contains("hide")) {
                this.checks.get("enable_custom_input_areas").checked = false;
            }

            let client_name = settings["client_name"];
            if (client_name)
                this.client_name_input.value = client_name;

        } catch {
            log(LogLevel.DEBUG, "Failed to load settings.")
            return;
        }
    }

    stretched_video() {
        return this.checks.get("stretch").checked
    }

    pointer_types() {
        let ptrs = [];
        if (this.checks.get("enable_mouse").checked)
            ptrs.push("mouse");
        if (this.checks.get("enable_stylus").checked)
            ptrs.push("pen");
        if (this.checks.get("enable_touch").checked)
            ptrs.push("touch");
        return ptrs;
    }

    toggle() {
        this.settings.classList.toggle("hide");
        this.visible = !this.visible;
    }

    onCapturableList(window_names: string[]) {
        let current_selection = undefined;
        if (this.capturable_select.selectedOptions[0])
            current_selection = this.capturable_select.selectedOptions[0].textContent;
        let new_index: number;
        this.capturable_select.innerText = "";
        window_names.forEach((name, i) => {
            let option = document.createElement("option");
            option.value = String(i);
            option.innerText = name;
            this.capturable_select.appendChild(option);
            if (name === current_selection)
                new_index = i;
        });
        if (new_index !== undefined)
            this.capturable_select.value = String(new_index);
        else if (current_selection)
            // Can't find the window, so don't select anything
            this.capturable_select.value = "";
    }

    toggle_energysaving(energysaving: boolean) {
        let canvas = fresh_canvas();
        if (energysaving) {
            let ctx = canvas.getContext("2d");
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        if (energysaving) {
            this.checks.get("enable_video").checked = false;
            this.checks.get("enable_video").disabled = true;
            this.checks.get("enable_video").dispatchEvent(new Event("change"));
        } else
            this.checks.get("enable_video").disabled = false;
        if (settings)
            new PointerHandler(this.webSocket);
    }

    video_enabled(): boolean {
        return this.checks.get("enable_video").checked;
    }
}

let settings: Settings;
let debug_overlay: HTMLElement;
let last_pointer_data: Object;

class PEvent {
    event_type: string;
    pointer_id: number;
    timestamp: number;
    is_primary: boolean;
    pointer_type: string;
    button: number;
    buttons: number;
    x: number;
    y: number;
    // movement_x: number;
    // movement_y: number;
    pressure: number;
    tilt_x: number;
    tilt_y: number;
    twist: number;
    width: number;
    height: number;

    constructor(eventType: string, event: PointerEvent, targetRect: DOMRect) {
        let diag_len = Math.sqrt(targetRect.width * targetRect.width + targetRect.height * targetRect.height)
        this.event_type = eventType.toString();
        this.pointer_id = event.pointerId;
        this.timestamp = Math.round(event.timeStamp * 1000);
        this.is_primary = event.isPrimary;
        this.pointer_type = event.pointerType;
        let btn = event.button;
        // for some reason the secondary and auxiliary buttons are ordered differently for
        // the button and buttons properties
        if (btn == 2)
            btn = 1;
        else if (btn == 1)
            btn = 2;
        this.button = (btn < 0 ? 0 : 1 << btn);
        this.buttons = event.buttons;
        let x_offset = 0;
        let y_offset = 0;
        let x_scale = 1;
        let y_scale = 1;
        if (settings.checks.get("enable_custom_input_areas").checked) {
            let custom_input_area: Rect = null;
            if (event.pointerType == "mouse") {
                custom_input_area = settings.custom_input_areas.mouse;
            } else if (event.pointerType == "touch") {
                custom_input_area = settings.custom_input_areas.touch;
            } else if (event.pointerType == "pen") {
                custom_input_area = settings.custom_input_areas.pen;
            }
            if (custom_input_area) {
                x_scale = custom_input_area.w;
                y_scale = custom_input_area.h;
                x_offset = custom_input_area.x;
                y_offset = custom_input_area.y;
            }
        }
        this.x = (event.clientX - targetRect.left) / targetRect.width * x_scale + x_offset;
        this.y = (event.clientY - targetRect.top) / targetRect.height * y_scale + y_offset;
        // this.movement_x = event.movementX ? event.movementX : 0;
        // this.movement_y = event.movementY ? event.movementY : 0;
        this.pressure = Math.max(event.pressure, settings.range_min_pressure.valueAsNumber);
        // The server expects whole numbers here; some browsers report fractions.
        this.tilt_x = Math.round(event.tiltX || 0);
        this.tilt_y = Math.round(event.tiltY || 0);
        this.width = event.width / diag_len;
        this.height = event.height / diag_len;
        this.twist = Math.round(event.twist || 0);
    }
}

class WEvent {
    dx: number;
    dy: number;
    timestamp: number;

    constructor(event: WheelEvent) {
        /* The WheelEvent can have different scrolling modes that affect how much scrolling
         * should be done. Unfortunately there is not always a way to accurately convert the scroll
         * distance into pixels. Thus the following is a guesstimate and scales the WheelEvent's
         * deltaX/Y values accordingly.
         */
        let scale = 1;
        switch (event.deltaMode) {
            case 0x01: // DOM_DELTA_LINE
                scale = 10;
                break;
            case 0x02: // DOM_DELTA_PAGE
                scale = 1000;
                break;
            default: // DOM_DELTA_PIXEL
        }
        this.dx = Math.round(scale * event.deltaX);
        this.dy = Math.round(scale * event.deltaY);
        this.timestamp = Math.round(event.timeStamp * 1000);
    }
}

// in milliseconds
const fade_time = 5000;

const vs_source = `
  attribute vec3 aVertex;
  uniform float uTime;
  varying lowp vec4 vColor;

  void main() {
    float dt = uTime - aVertex[2];
    gl_Position = vec4(aVertex[0], aVertex[1], 1.0, 1.0);
    vColor = vec4(0.0, 170.0/255.0, 1.0, 1.0) * max(1.0 - dt/${fade_time}.0, 0.0);
  }
`;

const fs_source = `
  varying lowp vec4 vColor;

  void main() {
    gl_FragColor = vColor;
  }
`;

class Painter {
    canvas: HTMLCanvasElement;
    gl: WebGLRenderingContext;

    /* Store lines currently being drawn.
     *
     * Keys are pointerIds, values are an array of the last position (x, y), thickness and event
     * time and another array with vertices to be used by webgl. Each vertex is made of 3 floats, x
     * and y coordinates and the event time. Vertices always come in pairs of two. Two such vertices
     * describe the edges of the line to be drawn with regard to it's thickness. TRIANGLE_STRIP is
     * then used to connect them and draw an actual line with some thickness depending on the
     * pressure applied.
     */
    lines_active: Map<number, [[number, number, number, number], number[]]>

    // Array of vertices that are not actively drawn anymore and do not need updates, except
    // removing them after they faded away.
    lines_old: number[][];
    vertex_attr: GLint;
    vertex_buffer: WebGLBuffer;
    time_attr: WebGLUniformLocation;
    initialized: boolean;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        canvas.width = window.innerWidth * window.devicePixelRatio;
        canvas.height = window.innerHeight * window.devicePixelRatio;
        this.gl = canvas.getContext("webgl");
        if (this.gl) {
            this.lines_active = new Map();
            this.lines_old = [];
            this.setupWebGL();
        }
    }

    loadShader(type, source): WebGLShader {
        let gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            log(LogLevel.WARN, "Failed to compile shaders: " + gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    setupWebGL() {
        let gl = this.gl;
        gl.enable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const vertex_shader = this.loadShader(gl.VERTEX_SHADER, vs_source);
        const fragment_shader = this.loadShader(gl.FRAGMENT_SHADER, fs_source);
        if (!vertex_shader || !fragment_shader)
            return;
        const shader_program = gl.createProgram();
        gl.attachShader(shader_program, vertex_shader);
        gl.attachShader(shader_program, fragment_shader);
        gl.linkProgram(shader_program);

        if (!gl.getProgramParameter(shader_program, gl.LINK_STATUS)) {
            log(LogLevel.WARN, "Unable to initialize the shader program: " + gl.getProgramInfoLog(shader_program));
            return;
        }
        this.vertex_attr = gl.getAttribLocation(shader_program, "aVertex");
        this.time_attr = gl.getUniformLocation(shader_program, "uTime");
        this.vertex_buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer);
        gl.vertexAttribPointer(this.vertex_attr, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.vertex_attr);
        gl.useProgram(shader_program);
        this.initialized = true;
        requestAnimationFrame(() => this.render());
    }

    render() {
        // only do work if necessary
        if (!check_video.checked && (this.lines_active.size > 0 || this.lines_old.length > 0)) {
            if (this.lines_old.length > 0) {
                if (performance.now() - this.lines_old[0][this.lines_old[0].length - 1] > fade_time)
                    this.lines_old.shift();
            }
            let gl = this.gl;
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform1f(this.time_attr, performance.now());
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer);
            for (let vertices of this.lines_old) {
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertices.length / 3)
            }
            for (let [_, vertices] of this.lines_active.values()) {
                // sometimes there are no linesegments because there has been only a single
                // PointerEvent
                if (vertices.length == 0)
                    continue;
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertices.length / 3)
            }
        }
        requestAnimationFrame(() => this.render());
    }

    appendEventToLine(event: PointerEvent) {
        let line = this.lines_active.get(event.pointerId);
        if (!line) {
            line = [null, []];
            this.lines_active.set(event.pointerId, line)
        }
        let max_pixels = Math.max(this.canvas.width, this.canvas.height);
        let x = event.clientX * window.devicePixelRatio / this.canvas.width * 2 - 1;
        let y = 1 - event.clientY * window.devicePixelRatio / this.canvas.height * 2;
        let delta = event.pressure + 0.4;
        let t = performance.now();
        // to draw a line segment, there has to be some previous position
        if (line[0]) {
            let [x0, y0, delta0, t0] = line[0];
            // get vector perpendicular to the linesegment to calculate quadrangel around the
            // segment with appropriate thickness
            let dx = (y - y0);
            let dy = -(x - x0);
            let dd = Math.sqrt(dx ** 2 + dy ** 2);
            if (dd == 0) {
                return;
            }
            dx = dx / dd * max_pixels / this.canvas.width * 0.004;
            dy = dy / dd * max_pixels / this.canvas.height * 0.004;

            if (line[1].length == 0)
                line[1].push(
                    x0 + delta0 * dx, y0 + delta0 * dy, t0, x0 - delta0 * dx, y0 - delta0 * dy, t0,
                );
            line[1].push(
                x + delta * dx, y + delta * dy, t, x - delta * dx, y - delta * dy, t
            )
        }
        line[0] = [x, y, delta, t];
    }

    onstart(event: PointerEvent) {
        this.appendEventToLine(event);
    }

    onmove(event: PointerEvent) {
        if (this.lines_active.has(event.pointerId)) {
            const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
            for (const e of events) {
                this.appendEventToLine(e);
            }
        }
    }

    onstop(event: PointerEvent) {
        let lines = this.lines_active.get(event.pointerId);
        if (lines) {
            if (lines[1].length > 0)
                this.lines_old.push(lines[1]);
            this.lines_active.delete(event.pointerId);
        }
    }
}

class PointerHandler {
    webSocket: WebSocket;
    pointerTypes: string[];

    constructor(webSocket: WebSocket) {
        let video = document.getElementById("video");
        let canvas = document.getElementById("canvas");
        this.webSocket = webSocket;
        this.pointerTypes = settings.pointer_types();

        video.onpointerdown = (e) => this.onEvent(e, "pointerdown");
        video.onpointerup = (e) => this.onEvent(e, "pointerup");
        video.onpointercancel = (e) => this.onEvent(e, "pointercancel");
        video.onpointermove = (e) => this.onEvent(e, "pointermove");
        video.onpointerout = (e) => this.onEvent(e, "pointerout");
        video.onpointerleave = (e) => this.onEvent(e, "pointerleave");
        video.onpointerenter = (e) => this.onEvent(e, "pointerenter");
        video.onpointerover = (e) => this.onEvent(e, "pointerover");

        let painter: Painter;
        if (!settings.checks.get("energysaving").checked)
            painter = new Painter(canvas as HTMLCanvasElement);

        if (painter && painter.initialized) {
            canvas.onpointerdown = (e) => { this.onEvent(e, "pointerdown"); painter.onstart(e); };
            canvas.onpointerup = (e) => { this.onEvent(e, "pointerup"); painter.onstop(e); };
            canvas.onpointercancel = (e) => { this.onEvent(e, "pointercancel"); painter.onstop(e); };
            canvas.onpointermove = (e) => { this.onEvent(e, "pointermove"); painter.onmove(e); };
            canvas.onpointerout = (e) => { this.onEvent(e, "pointerout"); painter.onstop(e); };
            canvas.onpointerleave = (e) => { this.onEvent(e, "pointerleave"); painter.onstop(e); };
            canvas.onpointerenter = (e) => { this.onEvent(e, "pointerenter"); painter.onmove(e); };
            canvas.onpointerover = (e) => { this.onEvent(e, "pointerover"); painter.onmove(e); };
        } else {
            canvas.onpointerdown = (e) => this.onEvent(e, "pointerdown");
            canvas.onpointerup = (e) => this.onEvent(e, "pointerup");
            canvas.onpointercancel = (e) => this.onEvent(e, "pointercancel");
            canvas.onpointermove = (e) => this.onEvent(e, "pointermove");
            canvas.onpointerout = (e) => this.onEvent(e, "pointerout");
            canvas.onpointerleave = (e) => this.onEvent(e, "pointerleave");
            canvas.onpointerenter = (e) => this.onEvent(e, "pointerenter");
            canvas.onpointerover = (e) => this.onEvent(e, "pointerover");
        }

        // This is a workaround for the following Safari/WebKit bug:
        // https://bugs.webkit.org/show_bug.cgi?id=217430
        // I have no idea why this works but it does.
        video.ontouchmove = (e) => e.preventDefault();
        canvas.ontouchmove = (e) => e.preventDefault();

        for (let elem of [video, canvas]) {
            elem.onwheel = (e) => {
                this.webSocket.send(JSON.stringify({ "WheelEvent": new WEvent(e) }));
            }
        }
    }

    onEvent(event: PointerEvent, event_type: string) {
        if (settings.checks.get("enable_debug_overlay").checked) {
            let props = [
                "altKey",
                "altitudeAngle",
                "azimuthAngle",
                "button",
                "buttons",
                "clientX",
                "clientY",
                "ctrlKey",
                "height",
                "isPrimary",
                "metaKey",
                "movementX",
                "movementY",
                "offsetX",
                "offsetY",
                "pageX",
                "pageY",
                "pointerId",
                "pointerType",
                "pressure",
                "screenX",
                "screenY",
                "shiftKey",
                "tangentialPressure",
                "tiltX",
                "tiltY",
                "timeStamp",
                "twist",
                "type",
                "width",
                "x",
                "y",
            ];
            if (!last_pointer_data) {
                last_pointer_data = {};
                for (let prop of props) {
                    let span_id = `prop_${prop}_span`;
                    let span = document.getElementById(span_id);
                    span = document.createElement("span");
                    span.id = span_id;
                    debug_overlay.appendChild(span);
                    debug_overlay.appendChild(document.createElement("br"));
                }
            }
            for (let prop of props) {
                let span_id = `prop_${prop}_span`;
                let span = document.getElementById(span_id);
                let v = event[prop];
                span.textContent = `${prop}: ${v}`;
                if (last_pointer_data[prop] == v) {
                    span.classList.remove("updated");
                } else {
                    span.classList.add("updated");
                    last_pointer_data[prop] = v;
                }
            }
        }
        // Tablet mode: fingers never reach the computer. They zoom/pan the view here and do
        // shortcut taps; only the pen (and mouse) draws.
        if (view_gestures && settings.checks.get("tablet_mode").checked) {
            if (event.pointerType == "touch") {
                view_gestures.on_touch(event, event_type);
                return;
            }
            if (event.pointerType == "pen")
                view_gestures.on_pen(event_type);
        }
        if (this.pointerTypes.includes(event.pointerType)) {
            let rect = (event.target as HTMLElement).getBoundingClientRect();
            const events = event_type === "pointermove" && typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
            for (let event of events) {
                this.webSocket.send(
                    JSON.stringify(
                        {
                            "PointerEvent": new PEvent(
                                event_type,
                                event,
                                rect
                            )
                        }
                    )
                );
            }
            if (settings.visible) {
                settings.toggle();
            }
        }
    }
}

// ---------------------------------------------------------------- tablet mode

// Finger touches within this long of any pen activity (touching or hovering) are palms.
const PEN_GRACE_MS = 500;
// A tap: every finger lifts within this long and none moves further than this.
const TAP_MAX_MS = 300;
const TAP_SLOP_PX = 12;
const MAX_ZOOM = 8;

class TouchPoint {
    x: number;
    y: number;
    start_x: number;
    start_y: number;
}

class Pinch {
    distance: number;
    mid_x: number;
    mid_y: number;
    scale: number;
    tx: number;
    ty: number;
}

/**
 * Tablet mode for the view on this device (nothing here reaches the computer, except the
 * shortcut taps):
 *  - two fingers pinch to zoom and drag to pan the picture; pinch back out to reset;
 *  - one finger does nothing, so a resting hand never draws or moves anything;
 *  - palm rejection: a touch sequence that starts while the pen is touching or hovering (or
 *    within PEN_GRACE_MS of it) is ignored entirely, and putting the pen down cancels any
 *    gesture in progress;
 *  - two-finger tap = undo (Ctrl+Z), three-finger tap = redo (Ctrl+Shift+Z).
 * The zoom is a CSS transform on #main. Pen coordinates are computed from the video's
 * on-screen rectangle, which includes this transform, so the pen still lands where it points.
 */
class ViewGestures {
    webSocket: WebSocket;
    main: HTMLElement;
    scale = 1;
    tx = 0;
    ty = 0;
    touches = new Map<number, TouchPoint>();
    max_touches = 0;
    sequence_start = 0;
    moved = false;
    rejected = false;
    pen_until = 0;
    pinch: Pinch = null;

    constructor(webSocket: WebSocket) {
        this.webSocket = webSocket;
        this.main = document.getElementById("main");
        this.main.style.transformOrigin = "0 0";
    }

    on_pen(event_type: string) {
        let now = performance.now();
        this.pen_until = now + PEN_GRACE_MS;
        if (event_type == "pointerdown" && this.touches.size > 0) {
            // the hand touched first, then the pen came down: it was a palm
            this.rejected = true;
            this.pinch = null;
        }
    }

    on_touch(event: PointerEvent, event_type: string) {
        let now = performance.now();
        let id = event.pointerId;
        switch (event_type) {
            case "pointerdown": {
                if (this.touches.size == 0) {
                    this.max_touches = 0;
                    this.moved = false;
                    this.rejected = false;
                    this.sequence_start = now;
                }
                if (now < this.pen_until)
                    this.rejected = true;
                this.touches.set(id, {
                    x: event.clientX, y: event.clientY,
                    start_x: event.clientX, start_y: event.clientY
                });
                this.max_touches = Math.max(this.max_touches, this.touches.size);
                this.begin_pinch();
                break;
            }
            case "pointermove": {
                let t = this.touches.get(id);
                if (!t)
                    return;
                t.x = event.clientX;
                t.y = event.clientY;
                if (Math.hypot(t.x - t.start_x, t.y - t.start_y) > TAP_SLOP_PX)
                    this.moved = true;
                if (!this.rejected && this.pinch)
                    this.update_pinch();
                break;
            }
            case "pointerup":
            case "pointercancel": {
                if (!this.touches.has(id))
                    return;
                this.touches.delete(id);
                if (this.touches.size > 0) {
                    this.begin_pinch(); // carry on with the fingers still down
                    return;
                }
                this.pinch = null;
                let tapped = event_type == "pointerup" && !this.rejected && !this.moved
                    && now - this.sequence_start <= TAP_MAX_MS;
                if (tapped && this.max_touches == 2)
                    this.send_shortcut(false);
                else if (tapped && this.max_touches == 3)
                    this.send_shortcut(true);
                if (this.scale < 1.05)
                    this.reset_view();
                break;
            }
        }
    }

    begin_pinch() {
        if (this.touches.size != 2 || this.rejected) {
            this.pinch = null;
            return;
        }
        let [a, b] = Array.from(this.touches.values());
        this.pinch = {
            distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
            mid_x: (a.x + b.x) / 2,
            mid_y: (a.y + b.y) / 2,
            scale: this.scale,
            tx: this.tx,
            ty: this.ty,
        };
    }

    update_pinch() {
        if (this.touches.size != 2)
            return;
        let [a, b] = Array.from(this.touches.values());
        let p = this.pinch;
        let distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        let mid_x = (a.x + b.x) / 2;
        let mid_y = (a.y + b.y) / 2;
        let scale = Math.min(MAX_ZOOM, Math.max(1, p.scale * distance / p.distance));
        // keep the picture point that was under the fingers' midpoint under it
        let content_x = (p.mid_x - p.tx) / p.scale;
        let content_y = (p.mid_y - p.ty) / p.scale;
        this.set_view(scale, mid_x - content_x * scale, mid_y - content_y * scale);
    }

    set_view(scale: number, tx: number, ty: number) {
        let w = this.main.clientWidth;
        let h = this.main.clientHeight;
        // never show anything outside the picture
        this.scale = scale;
        this.tx = Math.min(0, Math.max(w - w * scale, tx));
        this.ty = Math.min(0, Math.max(h - h * scale, ty));
        this.main.style.transform = scale == 1 ? "" :
            "translate(" + this.tx + "px, " + this.ty + "px) scale(" + scale + ")";
    }

    reset_view() {
        this.set_view(1, 0, 0);
    }

    send_shortcut(redo: boolean) {
        for (let event_type of ["down", "up"]) {
            this.webSocket.send(JSON.stringify({
                "KeyboardEvent": {
                    event_type: event_type,
                    code: "KeyZ",
                    key: "z",
                    location: 0,
                    alt: false,
                    ctrl: true,
                    shift: redo,
                    meta: false,
                }
            }));
        }
    }
}

let view_gestures: ViewGestures = null;

class KEvent {
    event_type: string;
    code: string;
    key: string;
    location: number;
    alt: boolean;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;

    constructor(event_type: string, event: KeyboardEvent) {
        this.event_type = event_type;
        this.code = event.code;
        this.key = event.key;
        this.location = event.location;
        this.alt = event.altKey;
        this.ctrl = event.ctrlKey;
        this.shift = event.shiftKey;
        this.meta = event.metaKey;
    }
}

class KeyboardHandler {
    webSocket: WebSocket;

    constructor(webSocket: WebSocket) {
        this.webSocket = webSocket;

        let d = document;
        let s = document.getElementById("settings")

        // Consume all KeyboardEvents, except the settings menu is open.
        // this avoids making the main/video/canvas element focusable by using
        // a tabindex which interferes with PointerEvent than can be considered
        // hovering.

        function settings_hidden() {
            return s.classList.contains("hide") || s.classList.contains("vanish");
        }

        d.onkeydown = (e) => {
            if (!settings_hidden())
                return true;
            if (e.repeat)
                return this.onEvent(e, "repeat");
            return this.onEvent(e, "down");
        };
        d.onkeyup = (e) => {
            if (!settings_hidden())
                return true;
            return this.onEvent(e, "up");
        };
        d.onkeypress = (e) => {
            if (!settings_hidden())
                return true;
            e.preventDefault();
            e.stopPropagation();
            return false;
        };
    }

    onEvent(event: KeyboardEvent, event_type: string) {
        this.webSocket.send(JSON.stringify({ "KeyboardEvent": new KEvent(event_type, event) }));
        event.preventDefault();
        event.stopPropagation();
        return false;
    }
}

function frame_rate_stats() {
    let t = performance.now();
    let fps = Math.round(frame_count / (t - last_fps_calc) * 10000) / 10;
    fps_out.value = fps.toString();
    frame_count = 0;
    last_fps_calc = t;
    setTimeout(() => frame_rate_stats(), 1500);
}

function handle_messages(
    webSocket: WebSocket,
    video: HTMLVideoElement,
    onConfigOk: Function,
    onConfigError: Function,
    onCapturableList: Function,
) {
    let mediaSource: MediaSource = null;
    let sourceBuffer: SourceBuffer = null;
    let queue = [];
    const MAX_BUFFER_LENGTH = 20;  // In seconds
    function upd_buf() {
        if (sourceBuffer == null)
            return;
        if (!sourceBuffer.updating && queue.length > 0 && mediaSource.readyState == "open") {
            let buffer_length = 0;
            if (sourceBuffer.buffered.length) {
                // Assume only one time range...
                buffer_length = sourceBuffer.buffered.end(0) - sourceBuffer.buffered.start(0);
            }
            if (buffer_length > MAX_BUFFER_LENGTH) {
                sourceBuffer.remove(0, sourceBuffer.buffered.end(0) - MAX_BUFFER_LENGTH / 2);
                // This will trigger updateend when finished
            } else {
                try {
                    sourceBuffer.appendBuffer(queue.shift());
                } catch (err) {
                    log(LogLevel.DEBUG, "Error appending to sourceBuffer:" + err);
                    // Drop everything, and try to pick up the stream again
                    if (sourceBuffer.updating)
                        sourceBuffer.abort();
                    sourceBuffer.remove(0, Infinity);
                }
            }
        }
    }
    webSocket.onmessage = (event: MessageEvent) => {
        if (typeof event.data == "string") {
            let msg = JSON.parse(event.data);
            if (typeof msg == "string") {
                if (msg == "NewVideo") {
                    let MS = window.ManagedMediaSource ? window.ManagedMediaSource : window.MediaSource;
                    mediaSource = new MS();
                    sourceBuffer = null;
                    video.src = URL.createObjectURL(mediaSource);
                    mediaSource.addEventListener("sourceopen", (_) => {
                        let mimeType = 'video/mp4; codecs="avc1.4D403D"';
                        if (!MS.isTypeSupported(mimeType))
                            mimeType = "video/mp4";
                        sourceBuffer = mediaSource.addSourceBuffer(mimeType);
                        sourceBuffer.addEventListener("updateend", upd_buf);
                        // try to recover from errors by restarting the video
                        if (sourceBuffer.onerror)
                            sourceBuffer.onerror = () => settings.send_server_config();
                    })
                } else if (msg == "ConfigOk") {
                    onConfigOk();
                }
            } else if (typeof msg == "object") {
                if ("CapturableList" in msg)
                    onCapturableList(msg["CapturableList"]);
                else if ("Error" in msg)
                    alert(msg["Error"]);
                else if ("ConfigError" in msg) {
                    onConfigError(msg["ConfigError"]);
                } else if ("CustomInputAreas" in msg) {
                    settings.custom_input_areas = msg["CustomInputAreas"];
                    settings.checks.get("enable_custom_input_areas").checked = true;
                    settings.save_settings();
                }
            }

            return;
        }

        // not a string -> got a video frame. Tell the server at once so it keeps sending
        // (it holds back new frames while too many are unacknowledged).
        webSocket.send('"FrameAck"');
        queue.push(event.data);
        upd_buf();
        frame_count += 1;

        // only seek if there is data available, some browsers choke otherwise
        if (video.seekable.length > 0) {
            let seek_time = video.seekable.end(video.seekable.length - 1);
            if (video.readyState >= (settings.check_aggressive_seek.checked ? 3 : 4)
                // but make sure to catch up if the video is more than 3 seconds behind
                || seek_time - video.currentTime > 3) {
                if (isFinite(seek_time))
                    video.currentTime = seek_time;
                else
                    log(LogLevel.WARN, "Failed to seek to end of video.")
            }

        }
    }
}

function check_apis() {
    let apis = [
        {
            attrs: ["MediaSource", "ManagedMediaSource"],
            msg: "This browser doesn't support MSE/MMS required to playback video stream, try upgrading!"
        },
        {
            attrs: ["PointerEvent"],
            msg: "This browser doesn't support PointerEvents, input will not work, try upgrading!"
        },
    ];

    outer:
    for (let d of apis) {
        for (let attr of d.attrs) {
            if (attr in window) {
                continue outer;
            }
        }
        log(LogLevel.ERROR, d.msg);
    }
}

function init() {
    check_apis();

    let protocol = document.location.protocol == "https:" ? "wss://" : "ws://";
    let webSocket = new WebSocket(
        protocol + window.location.hostname + ":" +
        window.location.port + "/ws" + window.location.search
    );
    webSocket.binaryType = "arraybuffer";

    debug_overlay = document.getElementById("debug_overlay");
    settings = new Settings(webSocket);
    view_gestures = new ViewGestures(webSocket);

    let video = document.getElementById("video") as HTMLVideoElement;
    let canvas = document.getElementById("canvas") as HTMLCanvasElement;

    video.oncontextmenu = function(event) {
        event.preventDefault();
        event.stopPropagation();
        return false;
    };
    canvas.oncontextmenu = function(event) {
        event.preventDefault();
        event.stopPropagation();
        return false;
    };

    let toggle_fullscreen_btn = document.getElementById("fullscreen") as HTMLButtonElement;

    if (document.exitFullscreen) {
        toggle_fullscreen_btn.onclick = () => {
            if (!document.fullscreenElement)
                document.body.requestFullscreen({ navigationUI: "hide" });
            else
                document.exitFullscreen();
        }
    } else {
        // if document.exitFullscreen is not present we are probably running on iOS/iPadOS.
        // As input is broken in fullscreen mode on these, do not offer fullscreen in the first
        // place.
        toggle_fullscreen_btn.parentElement.removeChild(toggle_fullscreen_btn);
    }

    let handle_disconnect = (msg: string) => {
        document.body.onclick = video.onclick = (e) => {
            e.stopPropagation();
            if (window.confirm(msg + " Reload page?"))
                location.reload();
        }
    }
    webSocket.onerror = () => handle_disconnect("Lost connection.");
    webSocket.onclose = () => handle_disconnect("Connection closed.");
    window.onresize = () => {
        view_gestures.reset_view();
        stretch_video();
        canvas.width = window.innerWidth * window.devicePixelRatio;
        canvas.height = window.innerHeight * window.devicePixelRatio;
        let [w, h] = calc_max_video_resolution(settings.scale_video_input.valueAsNumber);
        settings.scale_video_output.value = w + "x" + h;
        settings.send_server_config();
    }
    video.controls = false;
    video.disableRemotePlayback = true;
    video.onloadeddata = () => stretch_video();
    let is_connected = false;
    handle_messages(webSocket, video, () => {
        if (!is_connected) {
            new KeyboardHandler(webSocket);
            new PointerHandler(webSocket);
            is_connected = true;
        }
    },
        (err) => alert(err),
        (window_names) => settings.onCapturableList(window_names)
    );
    window.onunload = () => { webSocket.close(); }
    webSocket.onopen = function(event) {
        webSocket.send('"GetCapturableList"');
        if (!settings.video_enabled())
            webSocket.send('"PauseVideo"');

        settings.send_server_config();

        document.onvisibilitychange = () => {
            if (document.hidden) {
                webSocket.send('"PauseVideo"');
            } else if (settings.video_enabled()) {
                webSocket.send('"ResumeVideo"');
            }
        };
    }
    frame_rate_stats();
}

// object-fit: fill; <-- this is unfortunately not supported on iOS, so we use the following
// workaround
function stretch_video() {
    let video = document.getElementById("video") as HTMLVideoElement;
    if (settings.stretched_video()) {
        video.style.transform = "scaleX(" + document.body.clientWidth / video.clientWidth + ") scaleY(" + document.body.clientHeight / video.clientHeight + ")";
    } else {
        let scale = Math.min(document.body.clientWidth / video.clientWidth, document.body.clientHeight / video.clientHeight);
        video.style.transform = "scale(" + scale + ")";
    }
}
