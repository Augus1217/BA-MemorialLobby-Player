import com.badlogic.gdx.*;
import com.badlogic.gdx.backends.lwjgl3.*;
import com.badlogic.gdx.graphics.*;
import com.badlogic.gdx.graphics.g2d.*;
import com.badlogic.gdx.math.*;
import com.badlogic.gdx.files.FileHandle;
import com.badlogic.gdx.utils.*;
import com.esotericsoftware.spine.*;
import com.esotericsoftware.spine.utils.*;

// Ground-truth 渲染器：用 Skeleton Viewer 的 JAR 類別（官方 runtime 語義）
// 載入 skeleton、播指定動畫至指定時間、以 fit-to-skeleton 相機渲染、存 PNG。
// 用法：GT <dir> <skel> <outPng> [anim=Idle_01] [time=0] [W=1300 H=1006]
public class GT implements ApplicationListener {
    String dir, skelName, outPng, animName, chainName;
    float targetTime;
    int W, H;
    float mtxA = 0, mtxTx = 0, mtxTy = 0;
    TextureAtlas atlas;
    Skeleton skeleton;
    AnimationState state;
    SkeletonData skeletonData;
    SkeletonRenderer renderer = new SkeletonRenderer();
    TwoColorPolygonBatch batch;
    OrthographicCamera camera = new OrthographicCamera();
    int frame = 0;
    boolean done = false;

    public GT(String dir, String skel, String out, String anim, float time, int w, int h, float ma, float mtxTxIn, float mt, String chain) {
        this.dir = dir; skelName = skel; outPng = out; animName = anim;
        targetTime = time; W = w; H = h; mtxA = ma; mtxTx = mtxTxIn; mtxTy = mt;
    }

    public void create() {
        batch = new TwoColorPolygonBatch(2000);
        batch.setPremultipliedAlpha(false);   // 對應 viewer 的 PMA checkbox 未勾
        renderer.setPremultipliedAlpha(false);
        atlas = new TextureAtlas(new FileHandle(dir + "/" + skelName.replace(".skel", ".atlas").replace(".json", ".atlas")));
        SkeletonBinary loader = new SkeletonBinary(atlas);
        skeletonData = loader.readSkeletonData(new FileHandle(dir + "/" + skelName));
        skeleton = new Skeleton(skeletonData);
        AnimationStateData stateData = new AnimationStateData(skeletonData);
        state = new AnimationState(stateData);
        stateData.setDefaultMix(0.2f);
        if (animName == null) animName = "Idle_01";
        Animation a = skeletonData.findAnimation(animName);
        if (a == null) { System.out.println("GT-ERR anim not found: " + animName + " have=" + skeletonData.getAnimations().size); System.exit(2); }
        state.setAnimation(0, a, false);
        if (chainName != null) {
            Animation c = skeletonData.findAnimation(chainName);
            if (c == null) { System.out.println("GT-ERR chain not found: " + chainName); System.exit(2); }
            state.addAnimation(0, c, true, 0);
        }
        camera.setToOrtho(false, W, H);
        camera.update();
    }

    public void render() {
        if (done) return;
        float dt = 1f / 30f;
        state.update(dt);
        state.apply(skeleton);
        skeleton.update(dt);
        skeleton.updateWorldTransform(Skeleton.Physics.pose);
        frame++;
        if (frame < Math.max(3, Math.round(targetTime / dt))) return;

        // 相機：mtx 模式（a,ty → 重現 app 的 charScale 框架，可與捕獲逐像素對齊）
        // 或 fit-to-bones 模式（無 mtx 時）。pixi y-down：screen = a*y + ty。
        if (mtxA > 0) {
            // libGDX 世界 y-up、pixi 螢幕 y-down：用標準 y-up 相機，映射
            // screen_x = a*x + tx、screen_y_top = −a*y + ty（y 翻轉由 y-up 相機自然供給）
            float vw = W / mtxA, vh = H / mtxA;
            camera.setToOrtho(false, vw, vh);
            camera.position.set((W / 2f - mtxTx) / mtxA, (mtxTy - H / 2f) / mtxA, 0);
        } else {
            float bx0 = Float.MAX_VALUE, by0 = Float.MAX_VALUE, bx1 = -Float.MAX_VALUE, by1 = -Float.MAX_VALUE;
            for (Bone b : skeleton.getBones()) {
                bx0 = Math.min(bx0, b.getWorldX()); bx1 = Math.max(bx1, b.getWorldX());
                by0 = Math.min(by0, b.getWorldY()); by1 = Math.max(by1, b.getWorldY());
            }
            float cx = (bx0 + bx1) / 2f, cy = (by0 + by1) / 2f;
            float mm = 1.16f;
            camera.setToOrtho(false, Math.max((bx1 - bx0) * mm, 1), Math.max((by1 - by0) * mm, 1));
            camera.position.set(cx, cy, 0);
        }
        camera.update();
        Gdx.gl.glClearColor(0.435f, 0.435f, 0.462f, 1f);
        Gdx.gl.glClear(0x00004000);
        batch.setProjectionMatrix(camera.combined);
        batch.begin();
        renderer.draw(batch, skeleton);
        batch.end();
        // 存圖：glReadPixels → PPM（y-flip）
        java.nio.ByteBuffer bb = java.nio.ByteBuffer.allocateDirect(W * H * 4);
        org.lwjgl.opengl.GL11.glReadPixels(0, 0, W, H, 0x1908, 0x1401, bb);
        byte[] px = new byte[W * H * 4];
        bb.get(px);
        try {
            String ppm = outPng.replaceAll("\\.png$", "") + ".ppm";
            java.io.FileOutputStream fo = new java.io.FileOutputStream(ppm);
            fo.write(("P6\n" + W + " " + H + "\n255\n").getBytes());
            for (int y = H - 1; y >= 0; y--) {
                for (int x = 0; x < W; x++) {
                    int o = (y * W + x) * 4;
                    fo.write(px[o]); fo.write(px[o + 1]); fo.write(px[o + 2]);
                }
            }
            fo.close();
        } catch (Exception e) { System.out.println("GT-ERR save: " + e); }
        System.out.println("GT-OK " + outPng + " frame=" + frame + " time=" + (frame * dt));
        done = true;
        Gdx.app.postRunnable(() -> System.exit(0));
    }

    public void resize(int w, int h) { }
    public void pause() { }
    public void resume() { }
    public void dispose() { }

    public static void main(String[] args) throws Exception {
        String dir = args[0], skel = args[1], out = args[2];
        String anim = args.length > 3 ? args[3] : "Idle_01";
        float time = args.length > 4 ? Float.parseFloat(args[4]) : 0f;
        int w = args.length > 5 ? Integer.parseInt(args[5]) : 1300;
        int h = args.length > 6 ? Integer.parseInt(args[6]) : 1006;
        float ma = 0, mtxTx = 0, mt = 0;
        if (args.length > 7) {
            String[] mp = args[7].split(",");
            ma = Float.parseFloat(mp[0]);
            mtxTx = Float.parseFloat(mp[1]);
            mt = Float.parseFloat(mp[2]);
        }
        Lwjgl3ApplicationConfiguration cfg = new Lwjgl3ApplicationConfiguration();
        cfg.setWindowedMode(w, h);
        cfg.setTitle("GT");
        new Lwjgl3Application(new GT(dir, skel, out, anim, time, w, h, ma, mtxTx, mt, args.length > 8 ? args[8] : null), cfg);
    }
}
