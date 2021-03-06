/****************************************************************************
 Copyright (c) 2013-2014 Chukong Technologies Inc.

 http://www.cocos2d-x.org

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 ****************************************************************************/

//-----------------------//
//  1. cc.Layer          //
//  2. cc.LayerColor     //
//  3. cc.LayerGradient  //
//-----------------------//

/**
 * cc.Layer's rendering objects of Canvas
 */
(function(){
    //Layer's canvas render command
    cc.Layer.CanvasRenderCmd = function(renderable){
        cc.Node.CanvasRenderCmd.call(this, renderable);
        this._isBaked = false;
        this._bakeSprite = null;
    };

    var proto = cc.Layer.CanvasRenderCmd.prototype = Object.create(cc.Node.CanvasRenderCmd.prototype);
    proto.constructor = cc.Layer.CanvasRenderCmd;

    proto.bake = function(){
        if (!this._isBaked) {
            this._needDraw = true;
            cc.renderer.childrenOrderDirty = true;
            //limit: 1. its children's blendfunc are invalid.
            this._isBaked = this._cacheDirty = true;

            var children = this._node._children;
            for(var i = 0, len = children.length; i < len; i++)
                children[i]._renderCmd._setCachedParent(this);

            if (!this._bakeSprite){
                this._bakeSprite = new cc.BakeSprite();
                this._bakeSprite._parent = this._node;
            }
        }
    };

    proto.unbake = function(){
        if (this._isBaked) {
            cc.renderer.childrenOrderDirty = true;
            this._needDraw = false;
            this._isBaked = false;
            this._cacheDirty = true;

            var children = this._node._children;
            for(var i = 0, len = children.length; i < len; i++)
                children[i]._renderCmd._setCachedParent(null);
        }
    };

    proto.isBaked = function(){
        return this._isBaked;
    };

    proto.rendering = function(){
        if(this._cacheDirty){
            var node = this._node;
            var children = node._children, locBakeSprite = this._bakeSprite;
            //compute the bounding box of the bake layer.
            this.transform(this.getParentRenderCmd(), true);
            var boundingBox = this._getBoundingBoxForBake();
            boundingBox.width = 0|(boundingBox.width+0.5);
            boundingBox.height = 0|(boundingBox.height+0.5);
            var bakeContext = locBakeSprite.getCacheContext();
            locBakeSprite.resetCanvasSize(boundingBox.width, boundingBox.height);
            bakeContext.translate(0 - boundingBox.x, boundingBox.height + boundingBox.y);
            //  invert
            var t = cc.affineTransformInvert(this._worldTransform);
            bakeContext.transform(t.a, t.c, t.b, t.d, t.tx , -t.ty );

            //reset the bake sprite's position
            var anchor = locBakeSprite.getAnchorPointInPoints();
            locBakeSprite.setPosition(anchor.x + boundingBox.x, anchor.y + boundingBox.y);

            //visit for canvas
            node.sortAllChildren();
            cc.renderer._turnToCacheMode(this.__instanceId);
            for (var i = 0, len = children.length; i < len; i++) {
                children[i].visit(this);
            }
            cc.renderer._renderingToCacheCanvas(bakeContext, this.__instanceId);
            locBakeSprite.transform();                   //because bake sprite's position was changed at rendering.
            this._cacheDirty = false;
        }
    };

    proto.visit = function(parentCmd){
        if(!this._isBaked){
            cc.Node.CanvasRenderCmd.prototype.visit.call(this, parentCmd);
            return;
        }

        var _t = this, node = this._node;
        var children = node._children;
        var len = children.length;
        // quick return if not visible
        if (!node._visible || len === 0)
            return;

        _t._syncStatus(parentCmd);
        cc.renderer.pushRenderCommand(this);

        //the bakeSprite is drawing
        this._bakeSprite.visit(this);
    };

    proto._bakeForAddChild = function(child){
        if(child._parent == this._node && this._isBaked)
            child._renderCmd._setCachedParent(this);
    };

    proto._getBoundingBoxForBake = function(){
        var rect = null, node = this._node;

        //query child's BoundingBox
        if (!node._children || node._children.length === 0)
            return cc.rect(0, 0, 10, 10);

        var locChildren = node._children;
        for (var i = 0; i < locChildren.length; i++) {
            var child = locChildren[i];
            if (child && child._visible) {
                if(rect){
                    var childRect = child._getBoundingBoxToCurrentNode();
                    if (childRect)
                        rect = cc.rectUnion(rect, childRect);
                }else{
                    rect = child._getBoundingBoxToCurrentNode();
                }
            }
        }
        return rect;
    };
})();

/**
 * cc.LayerColor's rendering objects of Canvas
 */
(function(){
    //LayerColor's canvas render command
    cc.LayerColor.CanvasRenderCmd = function(renderable){
        cc.Layer.CanvasRenderCmd.call(this, renderable);
        this._needDraw = true;
        this._blendFuncStr = "source-over";
        this._bakeRenderCmd = new cc.CustomRenderCmd(this, this._bakeRendering);
    };
    var proto = cc.LayerColor.CanvasRenderCmd.prototype = Object.create(cc.Layer.CanvasRenderCmd.prototype);
    proto.constructor = cc.LayerColor.CanvasRenderCmd;

    proto.unbake = function(){
        cc.Layer.CanvasRenderCmd.prototype.unbake.call(this);
        this._needDraw = true;
    };

    proto.rendering = function (ctx, scaleX, scaleY) {
        var context = ctx || cc._renderContext,
            node = this._node,
            t = this._worldTransform,
            curColor = this._displayedColor,
            opacity = this._displayedOpacity / 255,
            locWidth = node._contentSize.width,
            locHeight = node._contentSize.height;

        if (opacity === 0)
            return;

        var needTransform = (t.a !== 1 || t.b !== 0 || t.c !== 0 || t.d !== 1);
        var needRestore = (this._blendFuncStr !== "source-over") || needTransform;

        if (needRestore) {
            context.save();
            context.globalCompositeOperation = this._blendFuncStr;
        }
        context.globalAlpha = opacity;
        context.fillStyle = "rgba(" + (0 | curColor.r) + "," + (0 | curColor.g) + ","
            + (0 | curColor.b) + ", 1)";
        if (needTransform) {
            context.transform(t.a, t.c, t.b, t.d, t.tx * scaleX, -t.ty * scaleY);
            context.fillRect(0, 0, locWidth * scaleX, -locHeight * scaleY);
        } else {
            context.fillRect(t.tx * scaleX, -t.ty * scaleY, locWidth * scaleX, -locHeight * scaleY);
        }
        if (needRestore)
            context.restore();
        cc.g_NumberOfDraws++;
    };

    proto.updateBlendFunc = function(blendFunc){
        this._blendFuncStr = cc.Node.CanvasRenderCmd._getCompositeOperationByBlendFunc(blendFunc);
    };

    proto._updateSquareVertices =
    proto._updateSquareVerticesWidth =
    proto._updateSquareVerticesHeight = function(){};

    proto._bakeRendering = function(){
        if(this._cacheDirty){
            var node = this._node;
            var locBakeSprite = this._bakeSprite, children = node._children;
            var len = children.length, i;

            //compute the bounding box of the bake layer.
            this.transform(this.getParentRenderCmd(), true);
            //compute the bounding box of the bake layer.
            var boundingBox = this._getBoundingBoxForBake();
            boundingBox.width = 0 | boundingBox.width;
            boundingBox.height = 0 | boundingBox.height;
            var bakeContext = locBakeSprite.getCacheContext();
            locBakeSprite.resetCanvasSize(boundingBox.width, boundingBox.height);
            var anchor = locBakeSprite.getAnchorPointInPoints(), locPos = node._position;
            if(node._ignoreAnchorPointForPosition){
                bakeContext.translate(0 - boundingBox.x + locPos.x, boundingBox.height + boundingBox.y - locPos.y);
                //reset the bake sprite's position
                locBakeSprite.setPosition(anchor.x + boundingBox.x - locPos.x, anchor.y + boundingBox.y - locPos.y);
            } else {
                var selfAnchor = this.getAnchorPointInPoints();
                var selfPos = {x: locPos.x - selfAnchor.x, y: locPos.y - selfAnchor.y};
                bakeContext.translate(0 - boundingBox.x + selfPos.x, boundingBox.height + boundingBox.y - selfPos.y);
                locBakeSprite.setPosition(anchor.x + boundingBox.x - selfPos.x, anchor.y + boundingBox.y - selfPos.y);
            }
            //  invert
            var t = cc.affineTransformInvert(this._worldTransform);
            bakeContext.transform(t.a, t.c, t.b, t.d, t.tx, -t.ty);

            var child;
            cc.renderer._turnToCacheMode(this.__instanceId);
            //visit for canvas
            if (len > 0) {
                node.sortAllChildren();
                // draw children zOrder < 0
                for (i = 0; i < len; i++) {
                    child = children[i];
                    if (child._localZOrder < 0)
                        child._renderCmd.visit(this);
                    else
                        break;
                }
                cc.renderer.pushRenderCommand(this);
                for (; i < len; i++) {
                    children[i]._renderCmd.visit(this);
                }
            } else
                cc.renderer.pushRenderCommand(this);
            cc.renderer._renderingToCacheCanvas(bakeContext, this.__instanceId);
            locBakeSprite.transform(this);
            this._cacheDirty = false;
        }
    };

    proto.visit = function(parentCmd){
        if(!this._isBaked){
            cc.Node.CanvasRenderCmd.prototype.visit.call(this);
            return;
        }

        var node = this._node;
        // quick return if not visible
        if (!node._visible)
            return;

        this._syncStatus(parentCmd);

        cc.renderer.pushRenderCommand(this._bakeRenderCmd);

        //the bakeSprite is drawing
        this._bakeSprite._renderCmd.setDirtyFlag(cc.Node._dirtyFlags.transformDirty);
        this._bakeSprite.visit(this);
    };

    proto._getBoundingBoxForBake = function(){
        var node = this._node;
        //default size
        var rect = cc.rect(0, 0, node._contentSize.width, node._contentSize.height);
        var trans = node.getNodeToWorldTransform();
        rect = cc.rectApplyAffineTransform(rect, node.getNodeToWorldTransform());

        //query child's BoundingBox
        if (!node._children || node._children.length === 0)
            return rect;

        var locChildren = node._children;
        for (var i = 0; i < locChildren.length; i++) {
            var child = locChildren[i];
            if (child && child._visible) {
                var childRect = child._getBoundingBoxToCurrentNode(trans);
                rect = cc.rectUnion(rect, childRect);
            }
        }
        return rect;
    };
})();

(function () {
    cc.LayerGradient.RenderCmd = {
        updateStatus: function () {
            var flags = cc.Node._dirtyFlags, locFlag = this._dirtyFlag;
            var colorDirty = locFlag & flags.colorDirty,
                opacityDirty = locFlag & flags.opacityDirty;
            if (colorDirty)
                this._updateDisplayColor()

            if (opacityDirty)
                this._updateDisplayOpacity();

            if (locFlag & flags.transformDirty) {
                //update the transform
                this.transform(null, true);
            }

            if (colorDirty || opacityDirty || (locFlag & flags.gradientDirty)){
                this._updateColor();
            }
        }
    };
})();

/**
 * cc.LayerGradient's rendering objects of Canvas
 */
(function(){
    cc.LayerGradient.CanvasRenderCmd = function(renderable){
        cc.LayerColor.CanvasRenderCmd.call(this, renderable);
        this._needDraw = true;
        this._startPoint = cc.p(0, 0);
        this._endPoint = cc.p(0, 0);
        this._startStopStr = null;
        this._endStopStr = null;
    };
    var proto = cc.LayerGradient.CanvasRenderCmd.prototype = Object.create(cc.LayerColor.CanvasRenderCmd.prototype);
    cc.inject(cc.LayerGradient.RenderCmd, proto);
    proto.constructor = cc.LayerGradient.CanvasRenderCmd;

    proto.rendering = function (ctx, scaleX, scaleY) {
        var context = ctx || cc._renderContext,
            self = this,
            node = self._node,
            opacity = this._displayedOpacity / 255,
            t = this._worldTransform;

        if (opacity === 0)
            return;

        var needTransform = (t.a !== 1 || t.b !== 0 || t.c !== 0 || t.d !== 1);
        var needRestore = (this._blendFuncStr !== "source-over") || needTransform;
        if (needRestore) {
            context.save();
            context.globalCompositeOperation = this._blendFuncStr;
        }
        context.globalAlpha = opacity;
        var locWidth = node._contentSize.width, locHeight = node._contentSize.height;

        var gradient = context.createLinearGradient(self._startPoint.x, self._startPoint.y, self._endPoint.x, self._endPoint.y);
        gradient.addColorStop(0, this._startStopStr);
        gradient.addColorStop(1, this._endStopStr);
        context.fillStyle = gradient;

        if (needTransform) {
            context.transform(t.a, t.c, t.b, t.d, t.tx * scaleX, -t.ty * scaleY);
            context.fillRect(0, 0, locWidth * scaleX, -locHeight * scaleY);
        } else
            context.fillRect(t.tx * scaleX, -t.ty * scaleY, locWidth * scaleX, -locHeight * scaleY);

        if (needRestore)
            context.restore();
        cc.g_NumberOfDraws++;
    };

    proto._syncStatus = function (parentCmd) {
        var flags = cc.Node._dirtyFlags, locFlag = this._dirtyFlag;
        var colorDirty = locFlag & flags.colorDirty,
            opacityDirty = locFlag & flags.opacityDirty;

        if (colorDirty)
            this._syncDisplayColor();

        if (opacityDirty)
            this._syncDisplayOpacity();

        if (locFlag & flags.transformDirty) {
            //update the transform
            this.transform(parentCmd);
        }

        if (colorDirty || opacityDirty || (locFlag & flags.gradientDirty)){
            this._updateColor();
        }
    };

    proto._updateColor = function(){
        var node = this._node;
        var contentSize = node._contentSize;
        var locAlongVector = node._alongVector, tWidth = contentSize.width * 0.5, tHeight = contentSize.height * 0.5;
        this._dirtyFlag = this._dirtyFlag & cc.Node._dirtyFlags.gradientDirty ^ this._dirtyFlag;

        this._startPoint.x = tWidth * (-locAlongVector.x) + tWidth;
        this._startPoint.y = tHeight * locAlongVector.y - tHeight;
        this._endPoint.x = tWidth * locAlongVector.x + tWidth;
        this._endPoint.y = tHeight * (-locAlongVector.y) - tHeight;

        var locStartColor = this._displayedColor, locEndColor = node._endColor;
        var startOpacity = node._startOpacity/255, endOpacity = node._endOpacity/255;
        this._startStopStr = "rgba(" + Math.round(locStartColor.r) + "," + Math.round(locStartColor.g) + ","
            + Math.round(locStartColor.b) + "," + startOpacity.toFixed(4) + ")";
        this._endStopStr = "rgba(" + Math.round(locEndColor.r) + "," + Math.round(locEndColor.g) + ","
            + Math.round(locEndColor.b) + "," + endOpacity.toFixed(4) + ")";
    };
})();